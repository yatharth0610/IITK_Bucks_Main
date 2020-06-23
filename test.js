const _ = require('lodash');

var hello = {
    hello: 'world',
    foo: 'bar'
};
var qaz = {
    hello: 'stevie',
    foo: 'baz'
}

var myArray = [];
myArray.push(hello,qaz);

let hello2 = {
    hello : 'world',
    foo : 'bar'
}

console.log(myArray);

_.remove(myArray, function(e) {
    return _.isEqual(e, hello2);
})

console.log(myArray);