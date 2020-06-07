const crypto = require('crypto');
const readline = require ('readline');
const fs = require ('fs');
const Transaction = require ("classes/Transaction");
const Input = require ("classes/Input");
const Output = require ("classes/Output");

let unusedOutputs = {};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question ("Enter the path of the transaction to be verified", str => {
    trans = fs.readFileSync(str);
    let ver = verifyTransaction(trans);
    if (ver === true) console.log ("Verified!");
    else console.log ("Verification Failed");
    rl.close();
})

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

    let obj = {
        numInputs : numInputs,
        Inputs : Inputs,
        numOutputs : numOutputs,
        Outputs : Outputs
    };

    return obj;
}

function createHash (numOutputs, Outputs) {
    let data = [];
    let out = transaction.numOutputs;
    let temp = [];
    temp = new Uint8Array(temp.concat(toBytesInt32(out))[0]);
    temp = [...temp];
    data = data.concat(temp);
    for (let i = 0; i < transaction.numOutputs; i++){
        let arr = [];
        let num1 = transaction.Outputs[i].coins;
        arr = new Uint8Array(arr.concat(toBytesInt64(num1)));
        arr = [...arr];
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

