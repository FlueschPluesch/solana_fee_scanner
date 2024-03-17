require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const solanaWeb3 = require('@solana/web3.js');

const port = process.env.SERVER_PORT; 
const logBlocks = process.env.LOG_BLOCKS;
const tickRate = process.env.TICK_RATE; 
const numberOfBlocksToConsider = process.env.NUMBER_OF_BLOCKS_TO_CONSIDER;
const accessToken = process.env.ACCESS_TOKEN;

const app = express();
let collectedBlocks = [];
let lastBlockId = null;

let averageFees = 0;
let averageComputeUnits = 0;
let minFees = 0;
let maxFees = 0;
let minComputeUnits = 0;
let maxComputeUnits = 0;

app.use(express.json());

//Rate-Limiting-Middleware
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // Limit IP to 30 requests per minute
    message: { error: 'Too many requests from this IP, please try again in a minute.' },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Application of the rate-limiting middleware to the API route only.
app.use('/api', apiLimiter);

// Middleware to check Token
const tokenMiddleware = (req, res, next) => {

    const { token } = req.query;

    if (token === accessToken) {

        next();

    } else {

        res.status(403).json({ error: 'Access denied!' });

    }

};

app.get('/api', tokenMiddleware, (req, res) => {

    const { get } = req.query;

    let response;

    switch (get) {

        case 'getFeeStats':

            response = {
                averageFees: averageFees,
                averageComputeUnits: averageComputeUnits,
                minFees: minFees,
                maxFees: maxFees,
                minComputeUnits: minComputeUnits,
                maxComputeUnits: maxComputeUnits
            };

            break;

        default:

            response = { error: 'Invalid request!' };

    }

    res.json({
        data: response,
        query: { get },
    });

});

// Middleware to reject all requests except to /api
app.use('*', (req, res) => {

    res.status(404).json({ error: 'This resource is not available.' });

});

app.listen(port, () => {

    console.log(`Server running on port ${port}.`);

});

//Init Solana connection
const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('mainnet-beta'), 'confirmed');

async function collectAndProcessBlocks() {

    try {
        // Retrieve the current block-id.
        const currentBlockId = await connection.getSlot();

        if (currentBlockId !== lastBlockId) {

            const blockContent = await connection.getBlock(currentBlockId, {
                transactionDetails: "full",
                rewards: false,
                maxSupportedTransactionVersion: 0
            });

            if (blockContent && blockContent.transactions) {

                if (logBlocks === true) {

                    // Write block data to a log file.
                    const logFilePath = path.join(__dirname, 'blockDataLog.txt');

                    fs.appendFile(logFilePath, JSON.stringify(blockContent, null, 2) + '\n\n', (err) => {
                        if (err) throw err;
                        console.log('Block data has been added to the log file.');
                    });

                }

                // Add the latest block to the array.
                collectedBlocks.push(blockContent);

                // Limit the array to the last N blocks.
                if (collectedBlocks.length > numberOfBlocksToConsider) {
                    collectedBlocks.shift(); // Remove the oldest block if the limit is exceeded.
                }

                // Calculate and output/save statistics.
                calculateAndPrintStats();
            }

            // Update the last retrieved block-id.
            lastBlockId = currentBlockId;

        } else {

            console.log(`Block-ID ${currentBlockId} has not changed. No re-download.`);

        }

        setTimeout(collectAndProcessBlocks, (tickRate * 1000));

    } catch (error) {

        console.error('Error in retrieving or processing the block contents:', error);

        setTimeout(collectAndProcessBlocks, (tickRate * 1000));

    }

}

function calculateAndPrintStats() {

    let totalTransactions = 0;
    let totalFeesLamports = 0;
    let totalComputeUnits = 0;
    let feesArray = [];
    let computeUnitsArray = [];

    collectedBlocks.forEach(block => {
        block.transactions.forEach(({ meta }) => {
            totalTransactions += 1;
            totalFeesLamports += meta.fee;
            totalComputeUnits += meta.computeUnitsConsumed;
            feesArray.push(meta.fee);
            computeUnitsArray.push(meta.computeUnitsConsumed);
        });
    });

    averageFees = totalFeesLamports / totalTransactions;
    averageComputeUnits = totalComputeUnits / totalTransactions;
    minFees = Math.min(...feesArray);
    maxFees = Math.max(...feesArray);
    minComputeUnits = Math.min(...computeUnitsArray);
    maxComputeUnits = Math.max(...computeUnitsArray);

    console.log(`Aggregated statistics for the last ${collectedBlocks.length} blocks:`);
    console.log(`Total number of transactions: ${totalTransactions}`);
    console.log(`Average fees: ${averageFees.toFixed(2)} Lamports`);
    console.log(`Average Compute Units: ${averageComputeUnits.toFixed(2)}`);
    console.log(`Minimum fees: ${minFees} Lamports`);
    console.log(`Maximum fees: ${maxFees} Lamports`);
    console.log(`Minimum Compute Units: ${minComputeUnits}`);
    console.log(`Maximum Compute Units: ${maxComputeUnits}`);
    console.log(`-------------------------------------------\n`);
}

// Start collecting block-data
collectAndProcessBlocks();