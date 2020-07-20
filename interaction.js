const crypto = require('crypto');
const { generateKeyPair } = require('crypto');
const axios = require('axios');
const fs = require('fs');
const Input = require ("./classes/Input");
const Output = require ("./classes/Output");
const readlineSync = require('readline-sync');

const myUrl = "https://81ee14f54b57.ngrok.io";
const works = ["Check Balance", "Generate Keys", "Transfer Coins", "Add Alias"];

let index = readlineSync.keyInSelect(works, 'Which task do you want to perform?');

switch (index) {
    case 0:
        checkBalance();
        break;
    case 1:
        generateKeys();
        break;
    case 2:
        transferCoins();
        break;
    case 3:
        addAlias();
        break;
}

function checkBalance() {
    console.log("Check Balance");
    let options = ["Public Key", "Alias"];
    let ind = readlineSync.keyInSelect(options, 'Select the option that you want to provide:');
    if (ind === 0) {
        let path = readlineSync.question("Enter the path of the public Key:");
        let pubKey = fs.readFileSync(path).toString('utf-8');
        axios.post(myUrl + '/getUnusedOutputs', {
            publicKey : pubKey
        })
        .then((res) => {
            let unusedOutputs = res.data.unusedOutputs;
            let balance = 0n;
            for (let i = 0; i < unusedOutputs.length; i++) {
                balance += BigInt(unusedOutputs[i].amount);
            }
            console.log("Your balance is: " + balance + " coins");
        })
        .catch((err) => {
            console.log(err);
        })
    }
    else {
        let alias = readlineSync.question("Enter your alias:");
        axios.post(myUrl + '/getUnusedOutputs', {
            alias : alias
        })
        .then((res) => {
            let unusedOutputs = res.data.unusedOutputs;
            let balance = 0n;
            for (let i = 0; i < unusedOutputs.length; i++) {
                balance += BigInt(unusedOutputs[i].amount);
            }
            console.log("Your balance is: " + balance + " coins");
        })
        .catch((err) => {
            console.log(err);
        })
    }
}

function generateKeys() {
    console.log("Generate keys");
    generateKeyPair('rsa', { 
        modulusLength : 2048, 
        publicKeyEncoding: { 
          type: 'spki', 
          format: 'pem'
        }, 
        privateKeyEncoding: { 
          type: 'pkcs8', 
          format: 'pem',
        } 
      }, 
       (err, publicKey, privateKey) => { 
             if(!err) 
             { 
               // Prints new asymmetric key 
               // pair after encodings 
               console.log("Public Key is: ", 
                        publicKey.toString('hex')); 
               console.log(); 
               console.log("Private Key is: ", 
                       privateKey.toString('hex')); 
      
              fs.writeFileSync("public.pem", publicKey);
              fs.writeFileSync("private.pem", privateKey);
             } 
             else
             { 
               // Prints error 
               console.log("Errr is: ", err); 
             } 
               
        }); 
}

function addAlias() {
    console.log("Add alias");
    const alias = readlineSync.question("Enter your alias :");
    const path = readlineSync.question("Enter the path for public key:");
    const publicKey = fs.readFileSync(path).toString('utf-8');
    axios.post(myUrl + '/addAlias', {
        alias : alias,
        publicKey : publicKey
    })
    .then((res) => {
        console.log("Request sent");
    })
    .catch((err) => {
        console.log(err);
    })
}

async function transferCoins() {
    console.log("Transfer coins");
    let pubKey = fs.readFileSync(readlineSync.question('Enter the path of your public Key:')).toString('utf-8');
    let privKey = fs.readFileSync(readlineSync.question('Enter the path of the private key:')).toString('utf-8');
    let obj = await getBalance(pubKey);
    let unusedOutputs = obj.unusedOutputs;
    let balance = BigInt(obj.balance);
    let numOutputs = Number(readlineSync.question('Enter the number of outputs:'));
    let Outputs = [];
    for (let i = 0; i < numOutputs; i++) {
        let options = ["Public Key", "Alias"];
        let index = readlineSync.keyInSelect(options, 'Select the option that you want to use:');
        if (index === 0) {
            let path = readlineSync.question('Enter the path of the public key:');
            let recipient = fs.readFileSync(path).toString('utf-8');
            let amount = BigInt(readlineSync.question('Enter the amount you want to transfer:'));
            let output = { amount : amount, recipient : recipient };
            Outputs.push(output);
        }
        else {
            let recipient = "";
            let alias = readlineSync.question('Enter the alias of the recipient:');
            await axios.post(myUrl + '/getPublicKey', {
                    alias : alias
            })
            .then((res) => {
                recipient = res.data.publicKey;
            })
            .catch((err) => {
                console.log(err);
            })
            let amount = BigInt(readlineSync.question('Enter the amount you want to transfer: '));
            let output = { amount : amount, recipient : recipient };
            Outputs.push(output);
        }
    }
    let transactionFees = BigInt(readlineSync.question('Enter the transaction fees you want to leave:'));
    let total = transactionFees;
    for (let i = 0; i < numOutputs; i++) total += Outputs[i].amount;
    if (total > balance) {
        console.log("Error!! You cannot spending more than what you have");
        return;
    }
    else {
        let curSum = 0n;
        for (let i = 0; i < unusedOutputs.length; i++) curSum += BigInt(unusedOutputs[i].amount); 
        let rem = curSum-total;
        let output = { amount : rem, recipient : pubKey };
        Outputs.push(output);
        let hash = createHash(numOutputs+1, Outputs);
        let Inputs = [];
        for (let i = 0; i < unusedOutputs.length; i++) {
            let transactionId = unusedOutputs[i].transactionId;
            let index = unusedOutputs[i].index;
            let data = [];
            let temp = [];
            temp = new Uint8Array(Buffer.from(transactionId, 'hex'));
            temp = [...temp];
            data = data.concat(temp);
            temp = [];
            temp = new Uint8Array(temp.concat(toBytesInt32(index))[0]);
            temp = [...temp];
            data = data.concat(temp);
            temp = [];
            temp = new Uint8Array(Buffer.from(hash, 'hex'));
            temp = [...temp];
            data = data.concat(temp);
            //console.log(data, Buffer.from(data));
            const sign = crypto.createSign('SHA256');
            sign.update(Buffer.from(data));
            signature = sign.sign({key:privKey, padding:crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength:32}).toString('hex');
            let input = {"transactionId" : transactionId, "index" : index, "signature" : signature};
            Inputs.push(input);
        }
        console.log(Inputs); console.log(Outputs);
        axios.post(myUrl + '/newTransaction', {
            "inputs" : Inputs,
            "outputs" : Outputs
        })
        .then((res) => {
            console.log("Transaction successfully sent");
        })
        .catch((err) => {
            console.log(err);
        })
    }
}

/******************* Utility Functions *******************/

BigInt.prototype.toJSON = function() {
    return this.toString();
}

async function getBalance(pubKey) {
    let unusedOutputs = [];
    let balance = 0n;
    await axios.post(myUrl + '/getUnusedOutputs', {
        publicKey : pubKey
    })
    .then((res) => {
        unusedOutputs = res.data.unusedOutputs;
        for (let i = 0; i < unusedOutputs.length; i++) {
            balance += BigInt(unusedOutputs[i].amount);
        }
        console.log("Your balance is: " + balance + " coins");
    })
    .catch((err) => {
        console.log(err);
    })
    return { balance : balance, unusedOutputs : unusedOutputs };
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

function createHash (numOutputs, Outputs) {
    let data = [];
    let out = numOutputs;
    let temp = [];
    temp = new Uint8Array(temp.concat(toBytesInt32(out))[0]);
    temp = [...temp];
    data = data.concat(temp);
    for (let i = 0; i < out; i++){
        let arr = [];
        let num1 = BigInt(Outputs[i].amount);
        arr = arr.concat([...toBytesInt64(num1)]);
        data = data.concat(arr);
        let num2 = Outputs[i].recipient.length;
        arr = [];
        arr = new Uint8Array(arr.concat(toBytesInt32(num2))[0]);
        arr = [...arr];
        data = data.concat(arr);
        let str = Outputs[i].recipient;
        arr = [];
        arr = new Uint8Array(Buffer.from(str, 'utf-8'));
        arr = [...arr];
        data = data.concat(arr);
    }
    let hashed = crypto.createHash('sha256').update(Buffer.from(data)).digest('hex');
    return hashed;
}