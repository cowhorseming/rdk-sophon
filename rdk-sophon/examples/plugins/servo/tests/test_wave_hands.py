import sys
import unittest
import os
from unittest.mock import MagicMock, Mock, call, patch

# 注入 mock GPIO 以避免导入时真实初始化
sys.modules['Hobot'] = MagicMock()
sys.modules['Hobot.GPIO'] = MagicMock()

# 添加路径以导入 ServoController
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from servo_ctrl import ServoController, WAVE_POSITION_HOLD_SECONDS


class TestWaveHands(unittest.TestCase):
    def setUp(self):
        # 创建控制器（此时 GPIO 初始化被 mock）
        self.ctrl = ServoController()

        # 创建一个共享 Mock 来收集所有方法调用顺序
        self.mock_sequence = Mock()
        self.ctrl.lift_left = self.mock_sequence.lift_left
        self.ctrl.lower_left = self.mock_sequence.lower_left
        self.ctrl.lift_right = self.mock_sequence.lift_right
        self.ctrl.lower_right = self.mock_sequence.lower_right
        self.sleep_patch = patch('servo_ctrl.time.sleep', self.mock_sequence.hold)
        self.sleep_patch.start()
        self.addCleanup(self.sleep_patch.stop)

    def test_wave_hands_sequence(self):
        # 执行动作
        self.ctrl.wave_hands()

        # 验证精确调用顺序，包括两次肉眼可见的姿态停留。
        expected_calls = [
            call.lift_left(),
            call.hold(WAVE_POSITION_HOLD_SECONDS),
            call.lower_left(),
            call.lift_right(),
            call.hold(WAVE_POSITION_HOLD_SECONDS),
            call.lower_right()
        ]
        self.assertEqual(self.mock_sequence.mock_calls, expected_calls)

if __name__ == '__main__':
    unittest.main()
