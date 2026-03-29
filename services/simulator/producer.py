from kafka import KafkaProducer
import json, time, random

# retry connection until kafka is ready
while True:
    try:
        producer = KafkaProducer(
            bootstrap_servers='kafka:9092',
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        print("Connected to Kafka")
        break
    except Exception as e:
        print("Kafka not ready, retrying...", e)
        time.sleep(5)

def random_entity(i):
    return {
        "id": f"drone-{i}",
        "lat": 37.77 + random.uniform(-0.05, 0.05),
        "lon": -122.41 + random.uniform(-0.05, 0.05),
        "altitude": random.randint(100, 1000),
        "speed": random.randint(10, 100)
    }

while True:
    for i in range(5):
        payload = random_entity(i)
        print("Sending:", payload)
        producer.send("sensor-data", payload)
    time.sleep(1)