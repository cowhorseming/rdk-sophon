import json
import os
import sys
import tempfile
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import MagicMock, patch


sys.modules["Hobot"] = MagicMock()
sys.modules["Hobot.GPIO"] = MagicMock()
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import servo_ctrl  # noqa: E402


class TestManagedActionRemoval(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.actions_dir = Path(self.temporary.name) / "servo_actions"
        self.actions_dir.mkdir()
        self.environment = patch.dict(
            os.environ,
            {"MAGICBOX_SERVO_ACTIONS_DIR": str(self.actions_dir)},
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def write_action(self, name="wave-left-hand"):
        (self.actions_dir / "actions.json").write_text(
            json.dumps({
                "version": 1,
                "actions": {name: {"module": name.replace("-", "_") + ".py", "start": "left"}},
            }),
            encoding="utf-8",
        )
        (self.actions_dir / (name.replace("-", "_") + ".py")).write_text(
            "def run(controller):\n    controller.lift_left()\n",
            encoding="utf-8",
        )

    def test_remove_deletes_active_code_and_registry_entry_with_backup(self):
        self.write_action()

        backup = servo_ctrl.remove_managed_action("wave-left-hand")

        registry = json.loads((self.actions_dir / "actions.json").read_text(encoding="utf-8"))
        self.assertNotIn("wave-left-hand", registry["actions"])
        self.assertFalse((self.actions_dir / "wave_left_hand.py").exists())
        self.assertTrue((backup / "actions.json").is_file())
        self.assertTrue((backup / "wave_left_hand.py").is_file())

    def test_registry_loads_only_the_matching_module_and_start_policy(self):
        self.write_action()

        run, start = servo_ctrl.load_managed_action("wave-left-hand")
        controller = MagicMock()
        run(controller)

        self.assertEqual(start, "left")
        controller.lift_left.assert_called_once_with()

    def test_remove_rejects_builtin_unknown_and_unsafe_names(self):
        with self.assertRaisesRegex(ValueError, "不是可删除"):
            servo_ctrl.remove_managed_action("lift-left")
        with self.assertRaisesRegex(ValueError, "动作名非法"):
            servo_ctrl.remove_managed_action("../servo_ctrl")

    def test_remove_main_does_not_construct_a_servo_controller(self):
        with patch.object(servo_ctrl, "remove_managed_action", return_value=Path("/tmp/backup")) as remove, \
                patch.object(servo_ctrl, "ServoController") as controller, \
                patch("sys.stdout", new_callable=StringIO), \
                patch.object(sys, "argv", ["servo_ctrl.py", "remove", "wave-left-hand"]):
            servo_ctrl.main()

        remove.assert_called_once_with("wave-left-hand")
        controller.assert_not_called()


if __name__ == "__main__":
    unittest.main()
