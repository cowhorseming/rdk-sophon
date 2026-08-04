#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
servo_ctrl.py —— MagicBox 舵机命令行控制脚本（无 ROS 依赖）

职责：
    把 magicbox_servo_control / magicbox_gesture_interaction 的层 1 语义动作
    （ActuatorsControl）封装成可从命令行直接调用的子命令，绕过 ROS，
    直接通过 Hobot.GPIO 驱动左/右腿两路舵机，必要时联动 WS2812B 灯带。

数值来源（严格照搬 actuators_control.cpp，勿随意改）：
    引脚（BOARD）：左腿 33，右腿 32      频率：50Hz
    左腿初始占空比 9.0%   右腿初始占空比 7.0%
    liftLeftLeg   : 左腿 9.0 - 5.0 = 4.0
    liftRightLeg  : 右腿 7.0 + 5.0 = 12.0
    lowerLeftLeg  : 左腿 9.0
    lowerRightLeg: 右腿 7.0
    standStraight : 先回初位，再 左 9.0+2.0=11.0 / 右 7.0-2.0=5.0 撑起
    relaxLegs     : 8 步平滑回初位
    shakeEars     : 5 轮 左3.0/右12.5 与 左6.0/右10.0 来回
    flashingLight : relax + 灯带闪烁（需 spidev）

用法：
    sudo ./servo_ctrl.py init                # 初始化并归位
    sudo ./servo_ctrl.py lift-left           # 抬左腿
    sudo ./servo_ctrl.py lift-right          # 抬右腿
    sudo ./servo_ctrl.py lower-left          # 放左腿
    sudo ./servo_ctrl.py lower-right         # 放右腿
    sudo ./servo_ctrl.py stand               # 站立
    sudo ./servo_ctrl.py relax               # 放松归位
    sudo ./servo_ctrl.py shake-ears          # 抖耳朵
    sudo ./servo_ctrl.py flash               # 闪灯
    sudo ./servo_ctrl.py wave-hands          # 先左后右依次摆动
    sudo ./servo_ctrl.py servo 0 -2.0        # 通用：通道0(左)占空比偏移 -2.0
    sudo ./servo_ctrl.py servo 1 3.0         # 通用：通道1(右)占空比偏移 +3.0

参数：
    --hold SEC   动作完成后保持该占空比的秒数（默认 1.0）；填 inf 则保持到 Ctrl-C
    --exchange   交换左右腿引脚（镜像机器人，对应 ROS 的 need_exchange=True）
    --no-lamp    flash 动作不操作灯带（仅放松腿部）

注意：
    每次调用都是独立进程，PWM 对象不跨进程保留；脚本退出前会 stop() + cleanup()，
    退出后舵机失去保持力矩会变软。需要长时间保持某姿态用 --hold inf。
"""

import sys
import time
import signal
import argparse
import atexit

try:
    import Hobot.GPIO as GPIO
except ImportError as e:
    sys.stderr.write("无法导入 Hobot.GPIO，请在 RDK X5 板端运行：{}\n".format(e))
    sys.exit(1)


# ---------------------------------------------------------------------------
# 硬件常量（与 actuators_control.h / fc_call_node.h 一致，BOARD 编号）
# ---------------------------------------------------------------------------
LEFT_LEG_PIN = 33        # 左腿
RIGHT_LEG_PIN = 32       # 右腿
PWM_FREQ = 50            # 50Hz，舵机标准频率

LEFT_INITIAL_DUTY = 9.0  # 左腿初始占空比
RIGHT_INITIAL_DUTY = 7.0  # 右腿初始占空比
WAVE_POSITION_HOLD_SECONDS = 0.8  # 让舵机实际到达抬起位置后再下发放下指令


class ServoController:
    """舵机控制器：封装层 1 的全部语义动作。"""

    def __init__(self, exchange=False):
        # exchange=True 时左右腿引脚互换，适配镜像装配的机器人
        if exchange:
            self.left_pin, self.right_pin = RIGHT_LEG_PIN, LEFT_LEG_PIN
        else:
            self.left_pin, self.right_pin = LEFT_LEG_PIN, RIGHT_LEG_PIN
        # 灯带对象延迟创建（只有 flash 才需要，避免无 spidev 时启动失败）
        self._lamp = None
        self._pwm_left = None
        self._pwm_right = None
        self._left_started = False
        self._right_started = False
        self._setup_gpio()

    def _setup_gpio(self):
        """初始化 GPIO 与两路 PWM 通道。"""
        GPIO.setwarnings(False)
        GPIO.setmode(GPIO.BOARD)
        # 建通道（对应 HobotPWM::addPWM）
        self._pwm_left = GPIO.PWM(self.left_pin, PWM_FREQ)
        self._pwm_right = GPIO.PWM(self.right_pin, PWM_FREQ)

    # ---- 底层：对应 HobotPWM 的三个原子方法 ----
    def _start_left(self, duty):
        """只启动左侧 PWM，避免单侧动作改动右侧姿态。"""
        self._pwm_left.ChangeDutyCycle(duty)
        self._pwm_left.start(duty)
        self._left_started = True

    def _start_right(self, duty):
        """只启动右侧 PWM，避免单侧动作改动左侧姿态。"""
        self._pwm_right.ChangeDutyCycle(duty)
        self._pwm_right.start(duty)
        self._right_started = True

    def _start(self, left_duty, right_duty):
        """启动两路 PWM 并设初始占空比（对应 startPWM）。"""
        self._start_left(left_duty)
        self._start_right(right_duty)

    def _set_left(self, duty):
        """改左腿占空比（对应 setDutyCycle(0, duty)）。"""
        self._pwm_left.ChangeDutyCycle(duty)

    def _set_right(self, duty):
        """改右腿占空比（对应 setDutyCycle(1, duty)）。"""
        self._pwm_right.ChangeDutyCycle(duty)

    # ---- 语义动作：对应 ActuatorsControl 的各方法 ----
    def initialize(self):
        """初始化并归位（对应 initializeLegs）。"""
        self._start(LEFT_INITIAL_DUTY, RIGHT_INITIAL_DUTY)
        self.relax()  # 抖动结束后放松腿部

    def lift_left(self):
        """抬左腿。"""
        self._set_left(LEFT_INITIAL_DUTY - 5.0)
        time.sleep(0.05)

    def lift_right(self):
        """抬右腿。"""
        self._set_right(RIGHT_INITIAL_DUTY + 5.0)
        time.sleep(0.05)

    def lower_left(self):
        """放左腿回初位。"""
        self._set_left(LEFT_INITIAL_DUTY)
        time.sleep(0.05)

    def lower_right(self):
        """放右腿回初位。"""
        self._set_right(RIGHT_INITIAL_DUTY)
        time.sleep(0.05)

    def stand(self):
        """双腿撑起站立。"""
        self._set_left(LEFT_INITIAL_DUTY)
        self._set_right(RIGHT_INITIAL_DUTY)
        time.sleep(0.05)
        self._set_left(LEFT_INITIAL_DUTY + 2.0)
        self._set_right(RIGHT_INITIAL_DUTY - 2.0)

    def relax(self):
        """8 步平滑回初位放松（对应 relaxLegs）。"""
        for i in range(8):
            self._set_left(LEFT_INITIAL_DUTY + 2.0 - i * 0.25)
            self._set_right(RIGHT_INITIAL_DUTY - 2.0 + i * 0.25)
            time.sleep(0.035)
        self._set_left(LEFT_INITIAL_DUTY)
        self._set_right(RIGHT_INITIAL_DUTY)

    def shake_ears(self):
        """抖耳朵（5 轮来回）。"""
        self._set_left(LEFT_INITIAL_DUTY - 3.0)
        self._set_right(RIGHT_INITIAL_DUTY + 3.0)
        time.sleep(0.3)
        for _ in range(5):
            self._set_left(LEFT_INITIAL_DUTY - 6.0)
            self._set_right(RIGHT_INITIAL_DUTY + 5.5)
            time.sleep(0.06)
            self._set_left(LEFT_INITIAL_DUTY - 3.0)
            self._set_right(RIGHT_INITIAL_DUTY + 3.0)
            time.sleep(0.06)

    def flash(self, use_lamp=True):
        """闪灯：放松腿部 + 灯带闪一次。"""
        self.relax()
        if not use_lamp:
            return
        lamp = self._get_lamp()
        if lamp is None:
            return
        lamp.clear()
        time.sleep(0.5)
        lamp.set_all_same_color(0, 255, 0)
        time.sleep(0.5)
        lamp.clear()

    def servo(self, index, duty):
        """通用舵机控制（对应 servoControl）。

        index: 0=左腿, 1=右腿
        duty : 占空比偏移量（叠加到初始位）
        """
        if index == 0:
            self._set_left(LEFT_INITIAL_DUTY + duty)
        elif index == 1:
            self._set_right(RIGHT_INITIAL_DUTY + duty)
        else:
            sys.stderr.write("Only 0 and 1 are supported\n")
            sys.exit(2)

    # ---- 灯带懒加载 ----
    def _get_lamp(self):
        if self._lamp is None:
            try:
                # 复用 MagicBox 既有实现，避免重复造轮子
                sys.path.insert(0, "/userdata/magicbox/launch/lamp")
                from ws2812b import WS2812B
                self._lamp = WS2812B(num_leds=4)
            except Exception as e:
                sys.stderr.write("灯带不可用，跳过灯光：{}\n".format(e))
                self._lamp = False  # 标记失败，不再重试
        return self._lamp if self._lamp is not False else None

    def wave_hands(self):
        """用户语义：左右手先后动作（底层为左右腿舵机）。
        严格顺序：lift_left → visible hold → lower_left →
        lift_right → visible hold → lower_right。
        """
        self.lift_left()
        time.sleep(WAVE_POSITION_HOLD_SECONDS)
        self.lower_left()
        self.lift_right()
        time.sleep(WAVE_POSITION_HOLD_SECONDS)
        self.lower_right()

    def wave_left_hand(self):
        """用户语义：仅挥动左手（底层为左腿舵机）。
        严格顺序：lift_left → visible hold → lower_left。
        不触发右侧动作，符合 LEFT_ONLY_ACTIONS 规范。
        """
        self.lift_left()
        time.sleep(WAVE_POSITION_HOLD_SECONDS)
        self.lower_left()

    # ---- 生命周期 ----
    def close(self):
        """只停止并清理本次进程实际启动的 PWM 通道。"""
        active_pins = []
        if self._left_started and self._pwm_left is not None:
            try:
                self._pwm_left.stop()
            except Exception:
                pass
            self._left_started = False
            active_pins.append(self.left_pin)
        if self._right_started and self._pwm_right is not None:
            try:
                self._pwm_right.stop()
            except Exception:
                pass
            self._right_started = False
            active_pins.append(self.right_pin)
        if active_pins:
            try:
                GPIO.cleanup(active_pins)
            except Exception:
                pass
        if self._lamp:
            try:
                self._lamp.close()
            except Exception:
                pass

# 子命令名 -> 动作映射
ACTIONS = {
    "init": lambda c: c.initialize(),
    "lift-left": lambda c: c.lift_left(),
    "lift-right": lambda c: c.lift_right(),
    "lower-left": lambda c: c.lower_left(),
    "lower-right": lambda c: c.lower_right(),
    "stand": lambda c: c.stand(),
    "relax": lambda c: c.relax(),
    "shake-ears": lambda c: c.shake_ears(),
    "flash": lambda c: c.flash(use_lamp=not getattr(c, "_no_lamp", False)),
    "wave-hands": lambda c: c.wave_hands(),
    "wave-left-hand": lambda c: c.wave_left_hand(),
}

LEFT_ONLY_ACTIONS = {"lift-left", "lower-left", "wave-left-hand"}
RIGHT_ONLY_ACTIONS = {"lift-right", "lower-right"}

HELP_EPILOG = """
常用示例:
  sophonctl servo init              初始化舵机并回到初始姿态
  sophonctl servo stand             双腿撑起站立
  sophonctl servo relax             平滑回到初始姿态并放松
  sophonctl servo wave-left-hand    挥动左手
  sophonctl servo shake-ears        摇耳朵
  sophonctl servo servo 0 -2.0      将左侧舵机占空比偏移 -2.0

动作说明:
  init                 初始化舵机并归位
  lift-left             抬起左腿
  lift-right            抬起右腿
  lower-left            放下左腿并回到初始位置
  lower-right           放下右腿并回到初始位置
  stand                双腿撑起站立
  relax                平滑回到初始姿态
  shake-ears           摇耳朵
  flash                放松腿部并闪烁灯带
  wave-hands           左右手依次摆动
  wave-left-hand       只挥动左手
  servo <index> <duty> 手动控制单路舵机：index 为 0（左）或 1（右），
                       duty 为相对初始位置的占空比偏移量

注意:
  这些动作会直接驱动舵机；执行前请确认机器人周围没有障碍物或人员。
  默认动作完成后保持 1 秒；使用 --hold inf 可保持到按 Ctrl-C。
  每次命令结束都会释放 PWM，舵机将不再保持当前姿态。
"""

def main():
    parser = argparse.ArgumentParser(
        description="MagicBox 舵机命令行控制（无 ROS 依赖）",
        usage="sophonctl servo <动作> [参数] [选项]",
        formatter_class=argparse.RawTextHelpFormatter,
        epilog=HELP_EPILOG,
    )
    parser.add_argument("action", help="要执行的动作；详见下方“动作说明”")
    parser.add_argument("args", nargs="*", help="仅 servo 动作需要：<index> <duty>")
    parser.add_argument("--hold", default="1.0",
                        help="动作完成后保持占空比的秒数；inf=保持到 Ctrl-C（默认 1.0）")
    parser.add_argument("--exchange", action="store_true",
                        help="交换左右腿引脚（镜像机器人）")
    parser.add_argument("--no-lamp", action="store_true",
                        help="flash 动作不操作灯带")
    args = parser.parse_args()

    ctrl = ServoController(exchange=args.exchange)
    ctrl._no_lamp = args.no_lamp

    def _cleanup(*_):
        ctrl.close()
        sys.exit(0)

    signal.signal(signal.SIGINT, _cleanup)
    signal.signal(signal.SIGTERM, _cleanup)
    atexit.register(ctrl.close)

    if args.action == "servo":
        if len(args.args) != 2:
            sys.stderr.write("servo 需要 2 个参数：index duty\n")
            sys.exit(2)
        index = int(args.args[0])
        duty = float(args.args[1])
        if index == 0:
            ctrl._start_left(LEFT_INITIAL_DUTY)
        elif index == 1:
            ctrl._start_right(RIGHT_INITIAL_DUTY)
        ctrl.servo(index, duty)
    elif args.action in ACTIONS:
        # 单侧动作只启动目标 PWM；双侧动作仍从两侧初位开始。
        if args.action in LEFT_ONLY_ACTIONS:
            ctrl._start_left(LEFT_INITIAL_DUTY)
        elif args.action in RIGHT_ONLY_ACTIONS:
            ctrl._start_right(RIGHT_INITIAL_DUTY)
        elif args.action != "init":
            ctrl._start(LEFT_INITIAL_DUTY, RIGHT_INITIAL_DUTY)
        ACTIONS[args.action](ctrl)
    else:
        sys.stderr.write("未知动作: {}，可选: {}\n".format(
            args.action, ", ".join(list(ACTIONS) + ["servo"])))
        sys.exit(2)

    # 保持阶段：让舵机有时间执行动作并保持姿态
    if args.hold == "inf":
        while True:
            time.sleep(1.0)
    else:
        time.sleep(float(args.hold))


if __name__ == "__main__":
    main()
