"""Build and POST the Shoulder Impingement program to the BSA backend."""
import json, urllib.request

UIDS = {
  "Cat-Cow Stretch":"b2007113903d3b11cc57d761bc1f64ac",
  "Doorway Pec Stretch":"0dc5a7ad69cadf1bb7b929ebce285b7f",
  "Shoulder CARS":"70f8439809e03c5cb48b94cf4fe8f11c",
  "Band Shoulder Dislocates":"210d4937269e8c06ff0816e553f73ef8",
  "90/90 Hip Switch":"94ac6965db89eef415dc7c18515fb4bf",
  "Hip CARs (Controlled Articular Rotations)":"5d9d51c1b27d12373a3d16071280021c",
  "Dumbbell Goblet Squat":"6285691c6debb6428b760064fc27612a",
  "Dumbbell Romanian Deadlift (RDL)":"d7d54e82f05a687b2a2cab94177d86ce",
  "Dumbbell Reverse Lunge":"94fa67cd9c1dd49063d769491e2829c1",
  "Stability Ball Single Leg Hip Thrust":"da76d3d6635d11432abd6ffe1fa04359",
  "Suitcase Carry":"5823e9f38d9980b933d82313d6a129ec",
  "Dead Bug":"7e9a69a081fd03b713f93401d2fd790a",
  "Couch Stretch":"4785a76eae5933fa8e746be8b71633d1",
  "Child's Pose (Shoulder Stretch)":"1207033d5e5f0e69676d19e7139b6978",
  "Rear Delt Lacrosse Ball Rollout":"ae3e10aec06942484072c82390dab828",
  "10 Deg Seal Barbell Row":"47ac5514c23e70bf190722d0b06d503b",
  "Bent Over DB Row":"f27b097d1ee3a4086327324c78f27a3e",
  "Band Lat Pulldowns Bent Over":"962694069143eb952c5324c6860eb545",
  "Kneeling Single Arm Pulldown":"015083941c1eae3d2c014de5c56896bc",
  "Rear Delt W Raise":"1e63e1cba44946f3cc3b9bf054ccaee5",
  "Cable Reverse Fly":"bdc5cfbd57900591d066ea33a1f38a1a",
  "Squat Position Face Pull":"93e27c56feb8090d192baa6adfea0d0d",
  "Kneeling Pallof Press":"6bd68d0b8abeee56212fed711ece292c",
  "Side Plank":"96f49efe7a8b2011275ced575cdaf7d7",
  "Hurdle Mobility (Full Circuit)":"93b0c07499d6b40e6e269f072223f473",
  "Tire Walk Ups":"ad3dde8f03cd6a2802232745e4eff658",
  "90/90 Hip Stretch":"dad63aa297acbb88c9918e299ba1d87f",
  "Box Squat":"4c56c45c0f6b6d96c89c2420a6dfa0e1",
  "Bulgarian Split Squat (Dumbbell)":"19b9cdd54994c791827151c71d7f9500",
  "Good Morning":"90c1111878b2ec1306ec4167367c6adb",
  "Stability Ball Single Leg Hip Thrust (Bent)":"ba77294554c442a4bf2d22b6e2a552c1",
  "Farmers Carry":"9ad489fddeaeef0809d1a63870aec31d",
  "Bench-Assisted Pigeon Stretch":"faadb1ccb6d786ceae76ff5fd1d2dfe5",
  "Jump Rope (Single Unders)":"99f2c34db01830ea112caf2b8c5bcbe2",
  "Tire Double Taps":"a671409ac999b06f2bf5e2dead1eded0",
}

_id = [1]
def nid():
    _id[0] += 1
    return _id[0]

def ex(name, *, sets=1, reps="", duration="", durationUnit="", qualifier="", notes="", baseMax="bodyweight"):
    uid = UIDS.get(name, "")
    return {
        "name": name, "sets": sets, "reps": reps,
        "duration": duration, "durationUnit": durationUnit,
        "qualifier": qualifier, "rest": "", "notes": notes,
        "youtube": f"https://iframe.videodelivery.net/{uid}" if uid else "",
        "baseMax": baseMax, "isPercentageBased": False,
    }

def block(btype, exercises, notes="", rounds="", restBetweenRounds=""):
    return {
        "id": nid(), "type": btype, "notes": notes, "exercises": exercises,
        "rounds": rounds, "timeLimit": "", "restInterval": "", "workInterval": "",
        "restBetweenRounds": restBetweenRounds, "themeText": "",
        "circuitType": None, "collapsed": False,
    }

d1 = [
    block("warmup", [
        ex("Cat-Cow Stretch", sets=2, reps="10"),
        ex("Doorway Pec Stretch", sets=2, duration="30", durationUnit="sec", qualifier="each side"),
        ex("Shoulder CARS", sets=2, reps="5", qualifier="each direction"),
        ex("Band Shoulder Dislocates", sets=2, reps="10", notes="Wide grip, no pain"),
        ex("90/90 Hip Switch", sets=2, reps="8", qualifier="each side"),
    ]),
    block("straight-set", [
        ex("Dumbbell Goblet Squat", sets=4, reps="8"),
        ex("Dumbbell Romanian Deadlift (RDL)", sets=4, reps="8"),
        ex("Dumbbell Reverse Lunge", sets=3, reps="10", qualifier="each leg"),
        ex("Stability Ball Single Leg Hip Thrust", sets=3, reps="10", qualifier="each leg"),
    ]),
    block("superset", [
        ex("Suitcase Carry", sets=3, duration="40", durationUnit="yd", qualifier="each side"),
        ex("Dead Bug", sets=3, reps="8", qualifier="each side"),
    ]),
    block("conditioning", [
        ex("Stationary Bike", sets=1, duration="15", durationUnit="min", notes="Moderate pace"),
    ]),
    block("cooldown", [
        ex("Couch Stretch", sets=2, duration="60", durationUnit="sec", qualifier="each leg"),
        ex("Child's Pose (Shoulder Stretch)", sets=2, duration="60", durationUnit="sec"),
    ]),
]

d2 = [
    block("warmup", [
        ex("Cat-Cow Stretch", sets=2, reps="10"),
        ex("Band Shoulder Dislocates", sets=2, reps="10"),
        ex("Doorway Pec Stretch", sets=2, duration="30", durationUnit="sec", qualifier="each side"),
        ex("Rear Delt Lacrosse Ball Rollout", sets=2, duration="60", durationUnit="sec", qualifier="each side"),
        ex("Shoulder CARS", sets=2, reps="5", qualifier="each direction"),
    ]),
    block("straight-set", [
        ex("10 Deg Seal Barbell Row", sets=3, reps="12", notes="Chest-supported — zero scap depression stress"),
        ex("Bent Over DB Row", sets=3, reps="10", qualifier="each side"),
        ex("Band Lat Pulldowns Bent Over", sets=3, reps="12"),
        ex("Kneeling Single Arm Pulldown", sets=3, reps="10", qualifier="each side"),
    ]),
    block("triset", [
        ex("Rear Delt W Raise", sets=4, reps="12"),
        ex("Cable Reverse Fly", sets=3, reps="12"),
        ex("Squat Position Face Pull", sets=3, reps="15"),
    ]),
    block("superset", [
        ex("Kneeling Pallof Press", sets=3, reps="10", qualifier="each side"),
        ex("Side Plank", sets=3, duration="30", durationUnit="sec", qualifier="each side"),
    ]),
    block("conditioning", [
        ex("Rowing Machine", sets=1, duration="10", durationUnit="min",
           notes="LIGHT technique pace only. If pinch in shoulder, swap to Stationary Bike."),
    ]),
    block("cooldown", [
        ex("Child's Pose (Shoulder Stretch)", sets=2, duration="60", durationUnit="sec"),
        ex("Doorway Pec Stretch", sets=2, duration="60", durationUnit="sec", qualifier="each side"),
    ]),
]

d3 = [
    block("warmup", [
        ex("Hurdle Mobility (Full Circuit)", sets=2, reps="1 round"),
        ex("Tire Walk Ups", sets=2, reps="10", qualifier="each leg"),
        ex("90/90 Hip Stretch", sets=2, duration="30", durationUnit="sec", qualifier="each side"),
        ex("Cat-Cow Stretch", sets=2, reps="10"),
    ]),
    block("straight-set", [
        ex("Box Squat", sets=4, reps="6"),
        ex("Bulgarian Split Squat (Dumbbell)", sets=3, reps="8", qualifier="each leg"),
        ex("Good Morning", sets=3, reps="10", notes="Bodyweight or light bar"),
        ex("Stability Ball Single Leg Hip Thrust (Bent)", sets=3, reps="12", qualifier="each leg"),
    ]),
    block("superset", [
        ex("Farmers Carry", sets=4, duration="40", durationUnit="yd"),
        ex("Dead Bug", sets=3, reps="8", qualifier="each side"),
    ]),
    block("conditioning", [
        ex("Outdoor Run", sets=1, duration="20", durationUnit="min",
           notes="Easy / Zone 2. Arms relaxed — zero shoulder load."),
    ]),
    block("cooldown", [
        ex("Couch Stretch", sets=2, duration="60", durationUnit="sec", qualifier="each leg"),
        ex("Bench-Assisted Pigeon Stretch", sets=2, duration="45", durationUnit="sec", qualifier="each side"),
    ]),
]

d4 = [
    block("warmup", [
        ex("Jump Rope (Single Unders)", sets=3, duration="1", durationUnit="min"),
        ex("Band Shoulder Dislocates", sets=2, reps="10"),
        ex("Tire Double Taps", sets=2, duration="30", durationUnit="sec"),
        ex("Shoulder CARS", sets=2, reps="5", qualifier="each direction"),
    ]),
    block("circuit", [
        ex("Dumbbell Goblet Squat", sets=1, reps="10"),
        ex("Stability Ball Single Leg Hip Thrust", sets=1, reps="8", qualifier="each leg"),
        ex("Bent Over DB Row", sets=1, reps="12"),
        ex("Rear Delt W Raise", sets=1, reps="12"),
        ex("Kneeling Pallof Press", sets=1, reps="10", qualifier="each side"),
    ], rounds="3", restBetweenRounds="90s", notes="3 rounds. 90s rest between rounds."),
    block("straight-set", [
        ex("Farmers Carry", sets=3, duration="40", durationUnit="yd"),
    ]),
    block("conditioning", [
        ex("Stationary Bike", sets=1, duration="20", durationUnit="min",
           notes="Intervals: 10 × 30s on / 60s easy"),
    ]),
    block("cooldown", [
        ex("Doorway Pec Stretch", sets=2, duration="60", durationUnit="sec", qualifier="each side"),
        ex("90/90 Hip Stretch", sets=2, duration="60", durationUnit="sec", qualifier="each side"),
        ex("Child's Pose (Shoulder Stretch)", sets=2, duration="60", durationUnit="sec"),
    ]),
]

program_data = {
    "mainMaxes": {"bench": 0, "squat": 0, "deadlift": 0, "powerClean": 0, "bodyweight": 0, "manual": 0},
    "totalWeeks": 1,
    "daysPerWeek": 4,
    "allWorkouts": {"1-1": d1, "1-2": d2, "1-3": d3, "1-4": d4},
}

payload = {
    "trainerEmail": "wisco.barbell@gmail.com",
    "programName": "Shoulder Impingement",
    "programNickname": "4-day rehab / safe strength",
    "programData": program_data,
}

req = urllib.request.Request(
    "https://app.bestrongagain.com/api/workout/save-program.php",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=30) as r:
    result = json.loads(r.read())
print(json.dumps(result, indent=2))
