
require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const client = new MongoClient(process.env.mongo_uri);

let db;

// Vehicle Types and Rates (per hour)
const rates = {
    motorcycle: 10,
    car: 20,
    bus: 40
};

// Connect to DB and initialize
async function initDB() {
    await client.connect();
    db = client.db("smart_parking");
    console.log("Connected to DB");
}

// Allocate Parking Spot
async function allocateSpot(vehicleType) {
    const spot = await db.collection("spots").findOneAndUpdate(
        { type: vehicleType, occupied: false },
        { $set: { occupied: true } },
        { returnDocument: "after" }
    );
    return spot.value;
}

// Calculate Fee
function calculateFee(entryTime, exitTime, type) {
    const hours = Math.ceil((exitTime - entryTime) / (1000 * 60 * 60));
    return rates[type] * hours;
}

// Vehicle Entry
app.post('/entry', async (req, res) => {
    const { plate, type } = req.body;
    const spot = await allocateSpot(type);

    if (!spot) return res.status(404).send("No available spots for this vehicle type");

    const transaction = {
        vehicle: { plate, type },
        spotId: spot._id,
        entryTime: new Date(),
        exitTime: null,
        fee: null
    };

    const result = await db.collection("transactions").insertOne(transaction);
    res.send({ message: "Vehicle parked", spotId: spot._id, transactionId: result.insertedId });
});

// Vehicle Exit
app.post('/exit', async (req, res) => {
    const { transactionId } = req.body;
    const transaction = await db.collection("transactions").findOne({ _id: new ObjectId(transactionId) });

    if (!transaction || transaction.exitTime) return res.status(400).send("Invalid or already completed transaction");

    const exitTime = new Date();
    const fee = calculateFee(transaction.entryTime, exitTime, transaction.vehicle.type);

    await db.collection("transactions").updateOne(
        { _id: new ObjectId(transactionId) },
        { $set: { exitTime, fee } }
    );

    await db.collection("spots").updateOne(
        { _id: transaction.spotId },
        { $set: { occupied: false } }
    );

    res.send({ message: "Vehicle exited", fee });
});

// Get Real-Time Availability
app.get('/availability', async (req, res) => {
    const available = await db.collection("spots").aggregate([
        { $match: { occupied: false } },
        { $group: { _id: "$type", count: { $sum: 1 } } }
    ]).toArray();
    res.send(available);
});

initDB().then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)));
