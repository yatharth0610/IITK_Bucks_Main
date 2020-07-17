const express = require ('express');
const bodyParser = require ('body-parser');
const crypto = require('crypto');
const fs = require ('fs');
const getRawBody = require('raw-body');
const Transaction = require ("./classes/Transaction");
const Input = require ("./classes/Input");
const Output = require ("./classes/Output");
const blocKHeader = require("./classes/Block_Header");
const axios = require('axios');
const _ = require('lodash');
const { Worker } = require('worker_threads');

const app = express();

app.use (bodyParser.urlencoded({extended : true}));
app.use (bodyParser.json());

let info = JSON.parse(fs.readFileSync('./config.json'));

const myUrl = info["my-url"];
const publicKey = fs.readFileSync('./public.pem').toString('utf-8');
const port = info["port"];

let unusedOutputs = {};
let keys = {};
let outputs = {};
let allUrls = [];
let pendingTransactions = [];
let peers = ["https://iitkbucks.pclub.in"];
let potentialPeers = info["potential-peers"];
let tempOutputs = {};
let numBlocks = 0;
let blockReward = 100000n;

/*************************** Util Functions ***********************/ 

BigInt.prototype.toJSON = function() {
    return this.toString();
}

function removeTransaction(array, elem) {
    _.remove(array, function(e) {
        return _.isEqual(e, elem);
    })
}

function getBlockHash(num) {
    let block = fs.readFileSync('Blocks/' + num + '.dat');
    let hash = crypto.createHash("sha256").update(Buffer.from(block.slice(0, 116))).digest('hex');
    return hash;
}

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

function toBytesInt32 (num) {
    arr = new ArrayBuffer(4); 
    view = new DataView(arr);
    view.setUint32(0, num, false); 
    return arr;
}

function toBytesInt64 (num){
    let arr = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
        arr[7-i] = parseInt(num%256n);
        num = num/256n;
    }
    return arr;
}

function getDetails (str) {
    
    let Inputs = [];
    let Outputs = [];
    let curr = 0;

    const numInputs = getInt(str, 0, 4);
    curr = curr + 4;
    
    for (let i = 0; i < numInputs; i++) {
        let transactionId = (Buffer.from(str)).toString("hex", curr, curr+32);
        curr += 32;
        let index = getInt(str, curr, curr+4);
        curr += 4;
        let sign_length = getInt(str, curr, curr+4);
        curr += 4;
        let signature = (Buffer.from(str)).toString("hex", curr, curr + sign_length);
        curr += sign_length;
        //console.log(signature);
        let In = new Input(transactionId, index, sign_length, signature);
        Inputs.push(In);
    }

    const numOutputs = getInt(str, curr, curr+4);
    curr += 4;
    
    for (let i = 0; i < numOutputs; i++){
        let coins = getInt(str, curr, curr+8);
        curr += 8;
        let pubkey_len = getInt(str, curr, curr+4);
        curr += 4;
        let pub_key = (Buffer.from(str)).toString("utf-8", curr, curr + pubkey_len);
        curr += pubkey_len;
        let Out = new Output(coins, pubkey_len, pub_key);
        Outputs.push(Out);
    }

    let obj = new Transaction(numInputs, Inputs, numOutputs, Outputs);

    return obj;
}

function transactionToByteArray (transaction) {
    var data = [];
    data = new Uint8Array(data.concat(toBytesInt32(transaction.numInputs))[0]);
    data = [...data];
    for (let i = 0; i < transaction.numInputs; i++) {
        let temp = [];
        let str1 = transaction.Inputs[i].transactionId;
        temp = new Uint8Array(Buffer.from(str1, 'hex'));
        temp = [...temp];
        while (temp.length != 32) temp.unshift(0);
        data = data.concat(temp);
        let num1 = transaction.Inputs[i].index;
        temp = [];
        temp = new Uint8Array(temp.concat(toBytesInt32(num1))[0]);
        temp = [...temp];
        data = data.concat(temp);
        let num2 = transaction.Inputs[i].sign_length;
        temp = [];
        temp = new Uint8Array(temp.concat(toBytesInt32(num2))[0]);
        temp = [...temp];
        data = data.concat(temp);
        let str2 = transaction.Inputs[i].sign;
        temp = [];
        temp = new Uint8Array(Buffer.from(str2, 'hex'));
        temp = [...temp];
        data = data.concat(temp);
    }
    let out = transaction.numOutputs;
    let temp = [];
    temp = new Uint8Array(temp.concat(toBytesInt32(out))[0]);
    temp = [...temp];
    data = data.concat(temp);
    for (let i = 0; i < transaction.numOutputs; i++){
        let arr = [];
        let num1 = BigInt(transaction.Outputs[i].coins);
        arr = arr.concat([...toBytesInt64(num1)]);
        data = data.concat(arr);
        let num2 = transaction.Outputs[i].pubkey_len;
        arr = [];
        arr = new Uint8Array(arr.concat(toBytesInt32(num2))[0]);
        arr = [...arr];
        data = data.concat(arr);
        let str = transaction.Outputs[i].pubkey;
        arr = [];
        arr = new Uint8Array(Buffer.from(str, 'utf-8'));
        arr = [...arr];
        data = data.concat(arr);
    }
    let new_data = new Uint8Array(Buffer.from(data));
    return new_data;
}

/******* Functions for validation of transactions *********/

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
        arr = arr.concat([...toBytesInt64(num1)]);
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

function verifyTrans1(trans, fees) {
    let data = getDetails(trans);
    if (data.Outputs[0].coins <= fees + blockReward) return true;
    else return false;
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
        let tup = [Inputs[i].transactionId, Inputs[i].index];
        if (tup in temp) {
            console.log("Due to 1");
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
            let tup = [Inputs[i].transactionId, Inputs[i].index];
            if (tup in unusedOutputs) continue;
            else {
                console.log("Due to 2");
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
        let coinsUsed = 0n;
        let coinsHave = 0n;
        for (let i = 0; i < numInputs; i++) {
            let tup = [Inputs[i].transactionId, Inputs[i].index];
            coinsHave += unusedOutputs[tup].coins;
        }
        for (let i = 0; i < numOutputs; i++) {
            coinsUsed += Outputs[i].coins;
        }
        if (coinsUsed > coinsHave) {
            console.log("Due to 3");
            flag = 0;
        }
    }
    else {
        return false;
    }
    // Verifies Signatures
    if (flag) {
        let message = createHash(numOutputs, Outputs);
        for (let i = 0; i < numInputs; i++) {
            let data = [];
            let temp = [];
            temp = new Uint8Array(Buffer.from(Inputs[i].transactionId, 'hex'));
            temp = [...temp];
            data = data.concat(temp);
            temp = [];
            temp = new Uint8Array(temp.concat(toBytesInt32(Inputs[i].index))[0]);
            temp = [...temp];
            data = data.concat(temp);
            temp = [];
            temp = new Uint8Array(Buffer.from(message, 'hex'));
            temp = [...temp];
            data = data.concat(temp);
            let tup = [Inputs[i].transactionId, Inputs[i].index];
            if (tup in unusedOutputs) {
                let pubKey = unusedOutputs[tup].pubkey;
                const verify = crypto.createVerify('SHA256')
                verify.update(Buffer.from(data));
                verifyRes = verify.verify({key:pubKey, padding:crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength:32}, Buffer.from(Inputs[i].sign, 'hex'))
                if (verifyRes === false) {
                    console.log("Due to 4");
                    flag = 0;
                    return false;
                }
            } 
        }
    }
    else {
        return false;
    }

    return true;
}

/********** Functions for mining of blocks **********/

let worker = new Worker('./miner.js');

function mineBlock(worker) {
    let size = 116;
    let body = [];
    let data = [];
    let block_data = [];
    let cur = 0;
    let fees = 0n;
    let index = numBlocks + 1;
    let parent_hash = getBlockHash(numBlocks);
    let target = "0000004" + '0'.repeat(57);

    if (pendingTransactions.length === 0) return;

    while (cur < pendingTransactions.length) {
        let buffer = transactionToByteArray(pendingTransactions[cur]);
        size += buffer.length;
        if (size > 1000116) break;
        
        if (verifyTransaction(buffer) === true) {
            let numInputs = pendingTransactions[cur].numInputs;
            let numOutputs = pendingTransactions[cur].numOutputs;
            for (let i = 0; i < numInputs; i++) {
                let tup = [pendingTransactions[cur].Inputs[i].transactionId, pendingTransactions[cur].Inputs[i].index];
                if (tup in unusedOutputs) {
                    fees += unusedOutputs[tup].coins;
                    tempOutputs[tup] = unusedOutputs[tup];
                    delete unusedOutputs[tup];
                }
            }
            for (let i = 0; i < numOutputs; i++) {
                fees -= pendingTransactions[cur].Outputs[i].coins;
            }
            let arr = [];
            arr = new Uint8Array(arr.concat(toBytesInt32(buffer.length))[0]);
            body = [...body, ...arr];
            body = [...body, ...buffer];
            console.log(body);
            cur++;
        }
    }

    for (let key in tempOutputs) {
        unusedOutputs[key] = tempOutputs[key];
        delete tempOutputs[key];
    }
    
    // Creating the first transaction of the block
    let output = new Output(fees + blockReward, 192, publicKey);
    let trans1 = new Transaction(0, [], 1, [output]);
    let buffer = transactionToByteArray(trans1);
    let arr = [];
    arr = new Uint8Array(arr.concat(toBytesInt32(buffer.length))[0]);
    console.log("Buffer length: ", buffer.length);
    data = [...data, ...arr];
    data = [...data, ...buffer];
    data = [...data, ...body];
    arr = [];
    arr = new Uint8Array(arr.concat(toBytesInt32(cur+1))[0]);
    arr = [...arr];
    data = arr.concat(data);

    let body_hash = crypto.createHash('sha256').update(Buffer.from(data)).digest('hex');
    let header = new blocKHeader(index, parent_hash, body_hash, target);
    worker.postMessage({type : "mine", header : header});
    worker.on('message', message => {
        console.log("Message received : ", message);
        for (let key in tempOutputs) {
            delete tempOutputs[key];
        }
        block_data = [...message.header];
        block_data = block_data.concat(data);
        let bin_data = new Uint8Array(Buffer.from(block_data));
        post_new_block(bin_data);
    })
}

function post_new_block(data) {
    numBlocks++;
    if (verifyBlock(Buffer.from(data)) === true) {
        processBlock(Buffer.from(data));
        fs.writeFileSync('Blocks/' + numBlocks + '.dat', data);
        console.log("New Block Added Successfully!");
        peers.forEach(function (url) {
            axios({
                method: 'post',
                url : url + '/newBlock',
                data : data,
                headers : {'Content-Type' : 'application/octet-stream'}
            })
            .then(function (response) {
                console.log("Sent Block");
            })
            .catch(function(err) {
                console.log(err);
            })
        })
        console.log("Block : ", data);
    }
    else console.log("Verification Failed");
}

function stopMining(worker) {
    worker.terminate().then(console.log("Worker Stopped"));
}

/********** Functions for initialisation of a node and processing/verification of block. ************/

function getPeers (url) {
    axios.post (url + '/newPeer', {
            "url" : myUrl,
        }) 
        .then((res) => {
            if (res.status === 200) {
                peers.push(url);
                console.log(peers);
            }
            else if (res.status === 500) {
                axios.get (url + '/getPeers')
                    .then((res) => {
                        let data = res.data.peers;
                        data.forEach(function (peer) {
                            potentialPeers.push(peer);
                        }) 
                    })
            }
        })
        .catch((err) => {
            console.log(err);
            axios.get (url + '/getPeers')
            .then((res) => {
                let data = res.data.peers;
                data.forEach(function (peer) {
                    potentialPeers.push(peer);
                }) 
            })
        })
}

async function saveBlock (blockNum, link) {
    const url = link + "/getBlock/" + blockNum;

    axios.get (url, {
        responseType : 'arraybuffer'
    })
        .then (async (response) => {
            const data = response.data;
            if (verifyBlock(Buffer.from(data)) === true) { 
                fs.writeFileSync("./Blocks/" + blockNum + ".dat", data);
                processBlock(Buffer.from(data));
                console.log("successful ", blockNum);
                numBlocks = blockNum;
                await saveBlock(blockNum+1, link);
            }
            else { 
                console.log("Invalid Block!");
                await saveBlock(blockNum+1, link);
            }
        })
        .catch ((err) => {
            console.log("All blocks received");
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
        let transID = crypto.createHash('sha256').update(Buffer.from(str.slice(cur, cur+size))).digest('hex');
        let trans = getDetails(str.slice(cur, cur + size));
        cur += size;
        removeTransaction(pendingTransactions, trans);
        let numInputs = trans.numInputs;
        for (let j = 0; j < numInputs; j++) {
            let input = trans.Inputs[j];
            let tup = [input.transactionId, input.index];
            if (tup in unusedOutputs){
                let pubKey = unusedOutputs[tup].pubkey;
                let object = {transactionId : tup[0], index : tup[1], amount : unusedOutputs[tup].coins};
                delete unusedOutputs[tup];
                removeTransaction(outputs[pubKey], object);
            }
        }
        let numOutputs = trans.numOutputs;
        for (let k = 0; k < numOutputs; k++) {
            let output = trans.Outputs[k];
            let tup = [transID, k];
            unusedOutputs[tup] = output;
            let pub_key = output.pubkey;
            let obj = {};
            obj.transactionId = transID;
            obj.index = k;
            obj.amount = output.coins;
            if (pub_key in outputs) {
                outputs[pub_key].push(obj);
            }
            else {
                outputs[pub_key] = [];
                outputs[pub_key].push(obj);
            }
        }
    }
    console.log("Processing of block done!!");
}

function verifyBlock (block) {
    let header = block.slice(0,116);
    let index = getInt(block, 0, 4);
    console.log(index);
    if (index !== 0) {
        let fees = 0n;
        let cur = 116;
        let numtransactions = getInt (block, cur, cur+4);
        cur += 4;
        console.log("Num transactions: ", numtransactions);
        let size = getInt(block, cur, cur + 4);
        cur += 4;
        let trans1 = block.slice(cur, cur + size);
        cur += size;
        for (let i = 1; i < numtransactions; i++) {
            let size = getInt(block, cur, cur+4);
            cur += 4;
            let trans = block.slice(cur, cur+size);
            cur += size;
            let data = getDetails(trans);
            let numInputs = data.numInputs;
            let inputs = data.Inputs;
            let numOutputs = data.numOutputs;
            let outputs = data.Outputs;
            for (let i = 0; i < numInputs; i++) {
                let tup = [inputs[i].transactionId, inputs[i].index];
                fees += unusedOutputs[tup].coins;
            }
            for (let i = 0; i < numOutputs; i++) {
                fees -= outputs[i].coins;
            }
            if (verifyTransaction(trans) === false) {
                    console.log("Due to verifyTransaction");
                    return false;
            }
        }
        if (!verifyTrans1(trans1, fees)) {
            console.log("Due to verifyTrans1");
            return false;
        }
    }
    let hashed = crypto.createHash('sha256').update(Buffer.from(block.slice(116))).digest('hex');
    if (verifyHeader(header, hashed)) return true;
    else {
        console.log("Due to header");
        return false;
    }
}

function verifyHeader (header, hash) {
    let cur = 0;
    let index = getInt(header, cur, cur + 4);
    cur += 4;
    let parentHash = header.toString("hex", cur, cur + 32);
    cur += 32;
    let bodyHash = header.toString("hex", cur, cur + 32);
    cur += 32;
    let target = header.toString("hex", cur, cur + 32);
    cur += 32;
    let timestamp = getInt (header, cur, cur + 8);
    cur += 8;
    let nonce = getInt (header, cur, cur + 8);
    if (bodyHash !== hash) {
        console.log("Due to bodyHash !=== hash");
        return false;
    }
    else {
        if (index === 0) {
            if (parentHash !== '0'.repeat(64)) return false;
            else if (target !== '0'.repeat(6) + '4' + '0'.repeat(57)) return false;
            else {
                let hashed = crypto.createHash('sha256').update(header).digest('hex');
                if (hashed >= target) return false;
            }
            return true;
        }
        else {
            const parent_hash = getBlockHash(index-1);
            if (parentHash !== parent_hash) {
                console.log("Due to parent Hash");
                return false;
            }
            else {
                const hashed = crypto.createHash('sha256').update(header).digest('hex');
                if (hashed >= target) {
                    console.log("Due to hash greater than target", hashed, target);
                    return false;
                }
            }
            return true;
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
        let blockNum = 0;
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
            let inputs = trans.inputs;
            let numInputs = inputs.length;
            let outputs = trans.outputs;
            let numOutputs = outputs.length;
            let Inputs = [];
            let Outputs = [];
            for (let i = 0; i < numInputs; i++) {
                let inp = new Input(inputs[i].transactionId, inputs[i].index, (inputs[i].signature.length)/2, inputs[i].signature);
                Inputs.push(inp);
            }
            for (let i = 0; i < numOutputs; i++) {
                outputs[i].amount = BigInt(outputs[i].amount);
                let out = new Output(outputs[i].amount, outputs[i].recipient.length, outputs[i].recipient);
                Outputs.push(out);
            }
            let transaction = new Transaction (numInputs, Inputs, numOutputs, Outputs);
            pendingTransactions.push(transaction);
        })
        console.log(pendingTransactions);
    })
    .catch((err) => {
        console.log(err);
    })

}

/************** Functions for handling of various routes on the server. *************/

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

app.post('/addAlias', function(req, res) {
    let alias = req.body.alias;
    let public_key = req.body.publicKey;
    if (alias in keys) {
        res.sendStatus(400);
    }
    else {
        peers.forEach(function (url) {
            axios.post(url + '/addAlias', {
                alias : alias,
                publicKey : public_key
            })
            .then(function(response) {
                console.log("Alias: ", alias, "sent to url: ", url);
            })
            .catch(function(err) {
                console.log(err);
            })
        })
        keys[alias] = public_key;
        console.log(keys[alias]);
        res.sendStatus(200);
    }
});

app.post('/getPublicKey', function(req, res) {
    let alias = req.body.alias;
    if (alias in keys) {
        let pubKey = keys[alias];
        res.set('Content-type', 'application/json');
        res.send({publicKey : pubKey});
    }
    else res.sendStatus(404);
})

app.post('/getUnusedOutputs', function(req, res) {
    let pubKey = req.body.publicKey;
    let alias = req.body.alias;
    if (pubKey !== undefined) {
        if (pubKey in outputs) {
            let obj = {};
            obj["unusedOutputs"] = outputs[pubKey];
            res.set('Content-type', 'application/json');
            res.send(obj);
        }
        else res.sendStatus(404);
    }
    else if (alias !== undefined) {
        if (alias in keys) {
            pubKey = keys[alias];
            let obj = {};
            if (pubKey in outputs) {
                obj["unusedOutputs"] = outputs[pubKey];
                res.set('Content-type', 'application/json');
                res.send(obj);
            }
            else res.sendStatus(404);
        }
        else res.sendStatus(404);
    }
}) 

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
            res.status(400).send("Error");
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
    console.log(data);
    if (verifyBlock(data) === true) {
        stopMining(worker);
        worker = new Worker('./miner.js');
        post_new_block(data);
        res.send("Block Added");
    }
    else {
        console.log("Block Verification Failed!");
        res.send("Verfication Failed!");
    }
});

app.post ('/newTransaction', function(req, res) {
    let inputs = req.body.inputs;
    let numInputs = inputs.length;
    let outputs = req.body.outputs;
    let numOutputs = outputs.length;
    let Inputs = [];
    let Outputs = [];
    for (let i = 0; i < numInputs; i++) {
        let inp = new Input(inputs[i].transactionId, inputs[i].index, (inputs[i].signature.length)/2, inputs[i].signature);
        Inputs.push(inp);
    }
    for (let i = 0; i < numOutputs; i++) {
        outputs[i].amount = BigInt(outputs[i].amount);
        let out = new Output(outputs[i].amount, outputs[i].recipient.length, outputs[i].recipient);
        Outputs.push(out);
    }
    let transaction = new Transaction (numInputs, Inputs, numOutputs, Outputs);
    
    if (!_.find(pendingTransactions, transaction)){
        pendingTransactions.push(transaction);
        console.log(pendingTransactions);
        console.log("Transaction added successfully!");
        peers.forEach(function (url) {
            axios.post(url + '/newTransaction', {
                "inputs" : inputs,
                "outputs" : outputs
            })
            .then((res) => {
                console.log("Transaction successfully sent to", url);
            })
            .catch((err) => {
                console.log(err);
            })
        })
        mineBlock(worker);
    }
    res.send("Transaction Added");
})

app.listen (port, function() {
    console.log("Server started on port " + port);
    setInterval(() => {
        mineBlock(worker);
    }, 480000);
})