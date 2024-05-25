require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const solanaWeb3 = require('@solana/web3.js');

const port = process.env.SERVER_PORT; 
const logBlocks = JSON.parse(process.env.LOG_BLOCKS);
const tickRate = process.env.TICK_RATE; 
const numberOfBlocksToConsider = process.env.NUMBER_OF_BLOCKS_TO_CONSIDER;
const accessToken = process.env.ACCESS_TOKEN;
const printStats = JSON.parse(process.env.PRINT_STATS);

const app = express();
let collectedBlocks = [];
let lastBlockId = null;

let blockInfo = {
	
	averageFees : 0,
	averageComputeUnits : 0,
	averageFeesPerComputeUnit : 0,
	averageFeesPerComputeUnitMicro : 0,
	minFees : 0,
	maxFees : 0,
	minComputeUnits : 0,
	maxComputeUnits : 0
	
}

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
				timeStamp : new Date().toLocaleString(),
				data : blockInfo
            };

            break;

        default:

            response = { error: 'Invalid request!' };

    }

    res.json(response);

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

function calculateStats() {

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

    blockInfo.averageFees = totalFeesLamports / totalTransactions;
    blockInfo.averageComputeUnits = totalComputeUnits / totalTransactions;
    blockInfo.averageFeesPerComputeUnit = totalFeesLamports / totalComputeUnits;
    blockInfo.averageFeesPerComputeUnitMicro = parseInt(blockInfo.averageFeesPerComputeUnit * 1000000);
    blockInfo.minFees = Math.min(...feesArray);
    blockInfo.maxFees = Math.max(...feesArray);
    blockInfo.minComputeUnits = Math.min(...computeUnitsArray);
    blockInfo.maxComputeUnits = Math.max(...computeUnitsArray);
	
	return totalTransactions;
    
}


function printStatsTerminal(totalTransactions) {
	
	console.log(`Aggregated statistics for the last ${collectedBlocks.length} blocks:`);
    console.log(`Total number of transactions: ${totalTransactions}`);
    console.log(`Average fees: ${blockInfo.averageFees.toFixed(2)} Lamports`);
    console.log(`Average Compute Units: ${blockInfo.averageComputeUnits.toFixed(2)}`);
    console.log(`Average fees per Compute Unit: ${blockInfo.averageFeesPerComputeUnit.toFixed(2)} Lamports / ${blockInfo.averageFeesPerComputeUnitMicro} MicroLamports`);
    console.log(`Minimum fees: ${blockInfo.minFees} Lamports`);
    console.log(`Maximum fees: ${blockInfo.maxFees} Lamports`);
    console.log(`Minimum Compute Units: ${blockInfo.minComputeUnits}`);
    console.log(`Maximum Compute Units: ${blockInfo.maxComputeUnits}`);
    console.log(`-------------------------------------------\n`);
	
}

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
                        console.log('\nBlock data has been added to the log file.\n');
                    });

                }

                // Add the latest block to the array.
                collectedBlocks.push(blockContent);

                // Limit the array to the last N blocks.
                if (collectedBlocks.length > numberOfBlocksToConsider) {
                    collectedBlocks.shift(); // Remove the oldest block if the limit is exceeded.
                }

                // Calculate and output/save statistics.
				
				if (printStats === true) {
					
					let totalTransactions = calculateStats();
					printStatsTerminal(totalTransactions);
					
				} else {

					calculateStats();
					
				}
				
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

// Start collecting block-data
collectAndProcessBlocks();
