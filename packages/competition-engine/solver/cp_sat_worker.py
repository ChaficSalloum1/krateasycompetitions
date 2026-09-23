"""Pinned JSON-lines boundary for the TournamentOS CP-SAT scheduling adapter."""

from __future__ import annotations

import json
import sys
from typing import Any


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, sort_keys=True, separators=(",", ":")))


def overlaps(left_start: int, left_end: int, right_start: int, right_end: int) -> bool:
    return left_start < right_end and right_start < left_end


def allowed_starts(task: dict[str, Any], resource: dict[str, Any], horizon: int) -> list[int]:
    duration = task["durationMinutes"]
    starts: list[int] = []
    for start in range(0, horizon - duration + 1):
        end = start + duration
        inside_calendar = any(start >= window["startMinute"] and end <= window["endMinute"] for window in resource["calendars"])
        outside_closures = all(not overlaps(start, end, closure["startMinute"], closure["endMinute"]) for closure in resource["closures"])
        if inside_calendar and outside_closures:
            starts.append(start)
    return starts


def search_limits(budget_seconds: float) -> tuple[float, float]:
    """The search stops on CP-SAT's deterministic time, so the same model and pinned backend reach the
    same answer on any machine; wall time is only a safety cap well beyond that budget."""
    return budget_seconds, budget_seconds * 2 + 5


def reproducible_status(status: str, wall_seconds: float, wall_cap_seconds: float) -> str:
    """OPTIMAL and INFEASIBLE are proofs. An unproven FEASIBLE answer is only reproducible when the
    deterministic budget ended the search; if the wall-time safety cap ended it, the answer depends on
    machine speed and is reported as UNKNOWN rather than published."""
    if status == "FEASIBLE" and wall_seconds >= wall_cap_seconds * 0.99:
        return "UNKNOWN"
    return status


def solve(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        import ortools
        from ortools.sat.python import cp_model
    except Exception as error:  # pragma: no cover - exercised through the TypeScript boundary
        return {"protocolVersion": 1, "status": "UNAVAILABLE", "diagnostic": type(error).__name__}

    required_version = payload.get("requiredBackendVersion")
    if ortools.__version__ != required_version:
        return {"protocolVersion": 1, "status": "UNAVAILABLE", "backendVersion": ortools.__version__, "diagnostic": "VERSION_MISMATCH"}

    try:
        problem = payload["problem"]
        max_time_seconds = float(payload["options"]["maxTimeSeconds"])
        tasks = sorted(problem["tasks"], key=lambda task: task["id"])
        resources = sorted(problem["resources"], key=lambda resource: resource["id"])
        resource_by_id = {resource["id"]: resource for resource in resources}
        task_by_id = {task["id"]: task for task in tasks}
        if len(resource_by_id) != len(resources) or len(task_by_id) != len(tasks):
            raise ValueError("duplicate ids")
        horizon = max((window["endMinute"] for resource in resources for window in resource["calendars"]), default=0)
        if horizon <= 0:
            raise ValueError("empty horizon")

        model = cp_model.CpModel()
        starts: dict[str, Any] = {}
        ends: dict[str, Any] = {}
        presences: dict[tuple[str, str], Any] = {}
        resource_intervals: dict[str, list[Any]] = {resource["id"]: [] for resource in resources}

        for task in tasks:
            task_id = task["id"]
            duration = int(task["durationMinutes"])
            if duration <= 0:
                raise ValueError("non-positive duration")
            starts[task_id] = model.new_int_var(0, horizon, f"start:{task_id}")
            ends[task_id] = model.new_int_var(0, horizon, f"end:{task_id}")
            model.add(ends[task_id] == starts[task_id] + duration)
            alternatives: list[Any] = []
            for resource_id in sorted(set(task["eligibleResourceIds"])):
                resource = resource_by_id.get(resource_id)
                if resource is None:
                    raise ValueError("unknown eligible resource")
                permitted = allowed_starts(task, resource, horizon)
                if not permitted:
                    continue
                presence = model.new_bool_var(f"use:{task_id}:{resource_id}")
                interval = model.new_optional_interval_var(starts[task_id], duration, ends[task_id], presence, f"interval:{task_id}:{resource_id}")
                model.add_allowed_assignments([starts[task_id]], [[value] for value in permitted]).only_enforce_if(presence)
                presences[(task_id, resource_id)] = presence
                resource_intervals[resource_id].append(interval)
                alternatives.append(presence)
            if alternatives:
                model.add_exactly_one(alternatives)
            else:
                model.add_bool_or([])

        for intervals in resource_intervals.values():
            if intervals:
                model.add_no_overlap(intervals)

        for task in tasks:
            for dependency_id in sorted(set(task["dependencyIds"])):
                if dependency_id not in task_by_id:
                    raise ValueError("unknown dependency")
                model.add(starts[task["id"]] >= ends[dependency_id])

        rest = int(problem["minimumRestMinutes"])
        if rest < 0:
            raise ValueError("negative rest")
        for left_index, left in enumerate(tasks):
            for right in tasks[left_index + 1:]:
                if not set(left["participantIds"]).intersection(right["participantIds"]):
                    continue
                left_first = model.new_bool_var(f"participant-order:{left['id']}:{right['id']}")
                model.add(starts[right["id"]] >= ends[left["id"]] + rest).only_enforce_if(left_first)
                model.add(starts[left["id"]] >= ends[right["id"]] + rest).only_enforce_if(left_first.negated())

        lock_by_task: dict[str, dict[str, Any]] = {}
        for lock in sorted(problem["locks"], key=lambda item: item["taskId"]):
            task_id = lock["taskId"]
            resource_id = lock["resourceId"]
            if task_id in lock_by_task or task_id not in task_by_id or resource_id not in resource_by_id:
                raise ValueError("invalid lock")
            lock_by_task[task_id] = lock
            presence = presences.get((task_id, resource_id))
            if presence is None:
                model.add_bool_or([])
            else:
                model.add(presence == 1)
                model.add(starts[task_id] == int(lock["startMinute"]))

        makespan = model.new_int_var(0, horizon, "makespan")
        model.add_max_equality(makespan, [ends[task["id"]] for task in tasks])
        model.minimize(makespan)

        deterministic_budget, wall_cap = search_limits(max_time_seconds)
        solver = cp_model.CpSolver()
        solver.parameters.max_deterministic_time = deterministic_budget
        solver.parameters.max_time_in_seconds = wall_cap
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = 0
        solver.parameters.log_search_progress = False
        status_code = solver.solve(model)
        solved_status = solver.status_name(status_code)
        status = reproducible_status(solved_status, solver.wall_time, wall_cap)
        response: dict[str, Any] = {
            "protocolVersion": 1,
            "status": status,
            "backendVersion": ortools.__version__,
            "branches": solver.num_branches,
            "conflicts": solver.num_conflicts,
        }
        if status != solved_status:
            response["diagnostic"] = "WALL_TIME_SAFETY_CAP"
            return response
        if status in ("OPTIMAL", "FEASIBLE"):
            assignments: list[dict[str, Any]] = []
            for task in tasks:
                task_id = task["id"]
                resource_id = next(resource_id for resource_id in sorted(set(task["eligibleResourceIds"]))
                                   if (task_id, resource_id) in presences and solver.value(presences[(task_id, resource_id)]) == 1)
                start = solver.value(starts[task_id])
                assignments.append({
                    "taskId": task_id,
                    "resourceId": resource_id,
                    "startMinute": start,
                    "endMinute": start + int(task["durationMinutes"]),
                    "locked": task_id in lock_by_task,
                })
            response["assignments"] = assignments
            response["objectiveValueMinutes"] = round(solver.objective_value)
            response["bestObjectiveBoundMinutes"] = round(solver.best_objective_bound)
        return response
    except Exception as error:
        return {
            "protocolVersion": 1,
            "status": "MODEL_INVALID",
            "backendVersion": ortools.__version__,
            "diagnostic": type(error).__name__,
        }


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
        emit(solve(payload))
    except Exception as error:
        emit({"protocolVersion": 1, "status": "MODEL_INVALID", "diagnostic": type(error).__name__})


if __name__ == "__main__":
    main()
