process.stdout.write(JSON.stringify({
  protocolVersion: 1,
  status: "OPTIMAL",
  backendVersion: "9.15.6755",
  assignments: [
    { taskId: "A", resourceId: "court.1", startMinute: 0, endMinute: 30, locked: false },
    { taskId: "B", resourceId: "court.1", startMinute: 0, endMinute: 30, locked: false },
  ],
  objectiveValueMinutes: 30,
  bestObjectiveBoundMinutes: 30,
  branches: 0,
  conflicts: 0,
}));
