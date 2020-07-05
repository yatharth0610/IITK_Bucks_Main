const { parentPort } = require('worker_threads');
const now = require('nano-time');
const crypto = require('crypto');

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

function mine(header, target) {
    let nonce = 0n;
    let timestamp = 0n;
    
    do {
        nonce++;
        timestamp = BigInt(now());
        let temp1 = [];
        temp1 = new Uint8Array(toBytesInt64(timestamp));
        temp1 = [...temp1];
        temp1 = header.concat(temp1);
        let temp2 = [];
        temp2 = new Uint8Array(toBytesInt64(nonce));
        temp2 = [...temp2];
        temp2 = header.concat(temp2);
        hashed = crypto.createHash('sha256').update("dryairship" + nonce).digest('hex');
        if (nonce%1000000n === 0) console.log(nonce, hashed);
    } while (hashed >= target);
    
    let temp1 = new Uint8Array(toBytesInt64(timestamp));
    temp1 = [...temp1];
    header = header.concat(temp1);
    let temp2 = [];
    temp2 = new Uint8Array(toBytesInt64(nonce));
    temp2 = [...temp2];
    header = header.concat(temp2);
    parentPort.postMessage({header : header});
}

parentPort.on('message', message => {
    let header = message.header;
    let data = [];
    data = new Uint8Array(data.concat(toBytesInt32(header.index))[0]);
    data = [...data];
    let temp = new Uint8Array(Buffer.from(header.parent_hash, 'hex'));
    temp = [...temp];
    data = data.concat(temp);
    temp = new Uint8Array(Buffer.from(header.body_hash, 'hex'));
    temp = [...temp];
    data = data.concat(temp);
    temp = new Uint8Array(Buffer.from(header.target, 'hex'));
    temp = [...temp];
    data = data.concat(temp);
    console.log(data);
    mine(data, header.target);
});