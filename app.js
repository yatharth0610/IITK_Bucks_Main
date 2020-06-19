const express = require ('express');
const bodyParser = require ('body-parser');
const crypto = require('crypto');
const fs = require ('fs');
const getRawBody = require('raw-body');
const Transaction = require ("../classes/Transaction");
const Input = require ("../classes/Input");
const Output = require ("../classes/Output");
const axios = require('axios');

const app = express();

app.use (bodyParser.urlencoded({extended : true}));
app.use (bodyParser.json());

const myUrl = "";

let unusedOutputs = {};
let allUrls = ["http://e8516e86ec21.ngrok.io"];
let pendingTransactions = [];
let peers = [];
let potentialPeers = [];
let numBlocks = 0;

/*const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question ("Enter the path of the transaction to be verified", str => {
    trans = fs.readFileSync(str);
    let ver = verifyTransaction(trans);
    if (ver === true) console.log ("Verified!");
    else console.log ("Verification Failed");
    rl.close();
})*/

function removeElement(array, elem) {
    var index = array.indexOf(elem);
    if (index > -1) {
        array.splice(index, 1);
    }
}

// Functions for validation of transactions and conversion of binary data to readable strings and numbers.

function getInt(str, start, end)
{
    let size = end - start;
    if(size === 4)
    {
        let ans = 0;
        for(let i = 0; i < size; ++i)
        {
            ans = ans << 8;
            ans += str[i + start];
        }
        return ans;
    }

    else
    {
        let ans = 0n;
        for (let i = 0; i < size; ++i)
        {
            ans = ans * 256n;
            ans += BigInt(str[i+start])
        }
        return ans;
    }
}

function getDetails (str) {
    
    let Inputs = [];
    let Outputs = [];
    let curr = 0;

    const numInputs = getInt(str, 0, 4);
    curr = curr + 4;

    for (let i = 0; i < numInputs; i++) {
        let transactionID = str.toString("hex", curr, curr+32);
        curr += 32;
        let index = getInt(str, curr, curr+4);
        curr += 4;
        let sign_length = getInt(str, curr, curr+4);
        curr += 4;
        let signature = str.toString("hex", curr, curr + sign_length);
        curr += sign_length;
        let In = new Input(transactionID, index, sign_length, signature);
        Inputs.push(In);
    }

    const numOutputs = getInt(str, curr, curr+4);
    curr += 4;

    for (let i = 0; i < numOutputs; i++){
        let coins = getInt(str, curr, curr+8);
        curr += 8;
        let pubkey_len = getInt(str, curr, curr+4);
        curr += 4;
        let pub_key = str.toString("utf-8", curr, curr + pubkey_len);
        curr += pubkey_len;
        let Out = new Output(coins, pubkey_len, pub_key);
        Outputs.push(Out);
    }

    let obj = new Transaction(numInputs, Inputs, numOutputs, Outputs);

    return obj;
}

function createHash (numOutputs, Outputs) {
    let data = [];
    let out = numOutputs;
    let temp = [];
    temp = new Uint8Array(temp.concat(toBytesInt32(out))[0]);
    temp = [...temp];
    data = data.concat(temp);
    for (let i = 0; i < numOutputs; i++){
        let arr = [];
        let num1 = Outputs[i].coins;
        arr = new Uint8Array(arr.concat(toBytesInt64(num1)));
        arr = [...arr];
        data = data.concat(arr);
        let num2 = Outputs[i].pubkey_len;
        arr = [];
        arr = new Uint8Array(arr.concat(toBytesInt32(num2))[0]);
        arr = [...arr];
        data = data.concat(arr);
        let str = Outputs[i].pubkey;
        arr = [];
        arr = new Uint8Array(Buffer.from(str, 'utf-8'));
        arr = [...arr];
        data = data.concat(arr);
    }
    let hashed = crypto.createHash('sha256').update(Buffer.from(data)).digest('hex');
    return hashed;
}

function verifyTransaction(trans) {
    let transaction = getDetails (trans);
    let numInputs = transaction.numInputs;
    let Inputs = transaction.Inputs;
    let numOutputs = transaction.numOutputs;
    let Outputs = transaction.Outputs;
    
    let flag = 1;
    // Checks if the same unused output is not used twice
    let temp = {};
    for (let i = 0; i < numInputs; i++) {
        let tup = [Inputs[i].transactionID, Inputs[i].index];
        if (tup in temp) {
            flag = 0;
            break;
        }
        else {
            temp[tup] = 1;
        }
    }
    // Checks if all the inputs are present in unused outputs or not.
    if (flag) {
        for (let i = 0; i < numInputs; i++) {
            let tup = [Inputs[i].transactionID, Inputs[i].index];
            if (tup in unusedOutputs) continue;
            else {
                flag = 0;
                break;           
            }
        }
    }
    else {
        return false;
    }
    // Checks if the amount of coins used is less than amount of coins obtained.
    if (flag) {
        let coinsUsed = 0;
        let coinsHave = 0;
        for (let i = 0; i < numInputs; i++) {
            let tup = [Inputs[i].transactionID, Inputs[i].index];
            coinsHave += unusedOutputs[tup].coins;
        }
        for (let i = 0; i < numOutputs; i++) {
            coinsUsed += Outputs[i].coins;
        }
        if (coinsUsed > coinsHave) flag = 0;
    }
    else {
        return false;
    }
    // Verifies Signatures
    if (flag) {
        let message = createHash(numOutputs, Outputs);
        for (let i = 0; i < numInputs; i++) {
            let tup = [Inputs[i].transactionID, Inputs[i].index];
            let pubKey = unusedOutputs[tup].pubKey;
            const verify = crypto.createVerify('SHA256');
            verify.update(Buffer.from(message, 'utf8'));
            verifyRes = verify.verify({key:pubKey, padding:crypto.constants.RSA_PKCS1_PSS_PADDING}, Buffer.from(Inputs[i].sign, 'hex'));
            if (verifyRes === false) {
                flag = 0;
                return false;
            } 
        }
    }
    else {
        return false;
    }

    return true;
}

// Functions for initialisation of a node and processing of block. 

function getPeers (url) {
    axios.post (url + '/newPeer', { 
        key : "url", value : myUrl}, { headers : {key : myUrl}, params : { key : myUrl}}) 
        .then((res) => {
            if (res.status === 200) {
                peers.push(url);
                console.log(peers);
            }
            else if (res.status === 500) {
                axios.get (url + '/getPeers')
                    .then((res) => {
                        let data = res.peers;
                        data.forEach(function (peer) {
                            potentialPeers.push(peer);
                        }) 
                    })
            }
        })
        .catch((err) => {
            console.log(err);
        })
}

async function saveBlock (blockNum, link) {
    const url = link + "/getBlock/" + blockNum;

    axios.get (url, 
        {
            responseType : 'stream',
        })
        .then ((response) => {
            const data = response.data;
            fs.writeFileSync("/Blocks/" + blockNum + ".dat", data);
            console.log("successful");
            blockNum++;
            saveBlock(blockNum, link);
            return true;
        })
        .catch ((err) => {
            console.log("Unsuccessful");
            return false;
        })
}

function processBlock (block) {
    let str = block;
    let cur = 116;
    let numtransactions = getInt (str, cur, cur+4);
    cur += 4;
    for (let i = 0; i < numtransactions; i++) {
        let size = getInt(str, cur, cur+4);
        cur += 4;
        let trans = getDetails(str.toString("hex", cur, cur + size));
        cur += size;
        removeElement(pendingTransactions, trans);
        let numInputs = trans.numInputs;
        for (let j = 0; j < numInputs; j++) {
            let input = trans.Inputs[j];
            removeElement (unusedOutputs, input);
        }
        let numOutputs = trans.numOutputs;
        for (let k = 0; k < numOutputs; k++) {
            let output = trans.Outputs[k];
            unusedOutputs.push(output);
        }
    }
}

async function initialiseNode () {
    const limit = 4;
    allUrls.forEach(async function (url) {
        if (peers.length <= limit/2) {
            await getPeers(url);
        }
    })
    setTimeout ( function () {
        getBlocks();
    }, 5000);
}

function getBlocks() {
    if (peers.length !== 0) {
        let peer = peers[0];
        console.log("Peer found");
        let blockNum = 1;
        saveBlock(blockNum, peer);
        pendingtrans(peer);
    }
    else {
        console.log("Found no peer!");
        return;
    }
}

function pendingtrans(peer) {
    axios.get (peer + '/getPendingTransactions')
    .then((res) => {
        let data = res.data;
        data.forEach (function (trans) {
            let Inputs = trans.inputs;
            let numInputs = Inputs.length;
            let Outputs = trans.outputs;
            let numOutputs = Outputs.length;
            let transaction = new Transaction(numInputs, Inputs, numOutputs, Ouputs);
            pendingTransactions.push(transaction);
        })
        console.log(pendingTransactions);
    })
}

// Functions for handling of various routes on the server.

app.use(function (req, res, next) {
    if (req.headers['content-type'] === 'application/octet-stream') {
        getRawBody(req, {
            length: req.headers['content-length'],
            encoding: req.charset
        }, function (err, string) {
            if (err)
                return next(err);

            req.body = string;
            next();
         })
    }
    else {
        next();
    }
});

app.get ('/getBlock/:number', function(req, res) {
    const n = req.params.number;
    const path = "Blocks/" + n + ".dat";
    try {
        if (fs.existsSync(path)) {
            const data = fs.readFileSync("Blocks/" + n + ".dat");
            res.set ('Content-Type', 'application/octet-stream') // Not required as express already sets the header to octet-stream when parameter is a buffer object.
            res.status(200).send(data);
        }
        else {
            res.send(400).send("Error");
        }
    }
    catch (err) {
        console.log(err.message);
    }
});

app.get ('/getPendingTransactions', function (req, res) {
    let data = [];
    pendingTransactions.forEach(function (transaction) {
        let inputs = transaction.Inputs;
        let outputs = transaction.Outputs;
        
        let temp = {};
        temp["inputs"] = inputs;
        temp["outputs"] = outputs;

        data.push(temp);
    })
    res.set ('Content-Type', 'application/json');
    res.send (data);
});

app.post ('/newPeer', function(req, res) {
    const url = req.body.url;
    const limit = 4;
    if (peers.length < limit) {
        peers.push(url);
        console.log("New peer added!", peers);
        res.sendStatus(200);
    }
    else {
        res.sendStatus(500);
    }
});

app.get ('/getPeers', function(req, res) {
    let data = {};
    data["peers"] = peers;
    console.log(data);
    res.json (data);
});

app.post ('/newBlock', function(req, res) {
    const data = req.body;
    console.log("Block received");
    //console.log(data);
    numBlocks++;
    fs.writeFileSync('Blocks/' + numBlocks + '.dat', data);
    console.log("New Block Added Successfully!");
    res.send("Block Added");
});

app.post ('/newTransaction', function(req, res) {
    let inputs = req.body.inputs;
    let numInputs = inputs.length;
    let outputs = req.body.outputs;
    let numOutputs = outputs.length;
    let transaction = new Transaction (numInputs, inputs, numOutputs, outputs);

    pendingTransactions.push(transaction);
    console.log(inputs[0]);
    console.log("Transaction added successfully!");
    res.send("Transaction added");
})

app.listen (3000, function() {
    console.log("Server started on port 3000");
})