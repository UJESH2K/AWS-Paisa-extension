"""EventBridge Scheduler entry point. Input: {"task": "fx" | "digest"}."""
import alert_checker
import fx_refresher


def handler(event, context):
    task = (event or {}).get("task")
    if task == "fx":
        return fx_refresher.handler(event, context)
    if task == "digest":
        return alert_checker.handler(event, context)
    raise ValueError(f"unknown task: {task!r}")
