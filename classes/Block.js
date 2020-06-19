class blockHeader {
    constructor (index, parent_hash, body_hash, target) {
        this.index = index;
        this.parent_hash = parent_hash;
        this.body_hash = body_hash;
        this.target = target;
    }
}

class Block {
    constructor (blockHeader, numTransactions, Transactions) {
        this.blockHeader = blockHeader;
        this.numTransactions = numTransactions;
        this.transactions = Transactions;
    }
}

module.exports = Block;