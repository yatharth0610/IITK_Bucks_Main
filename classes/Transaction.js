class Transaction {
    constructor (numInputs, Inputs, numOutputs, Outputs) {
        this.numInputs = numInputs;
        this.Inputs = Inputs;
        this.numOutputs = numOutputs;
        this.Outputs = Outputs;
    }
}

module.exports = Transaction;