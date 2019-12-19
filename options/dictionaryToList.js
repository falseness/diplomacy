function list(dictionary)
{
    let list = []
    for (i in dictionary)
        list.push(dictionary[i])
    
    return list
}
function dictionaryLength(dictionary) {
    return list(dictionary).length
}

function coordDictionary(l) {
    let res = new Array(l.length)
    for (let i = 0; i < l.length; ++i) {
        res[i] = {
            x: l[i][0],
            y: l[i][1]
        }
    }
    return res
}
function goldmineDictionary(l) {
    let res = coordDictionary(l)
    for (let i = 0; i < res.length; ++i) {
        res[i].income = l[i][2]
    }
    return res
}

function getKeyByIndexDictionary(dictionary, index) {
    let i = 0
    for (item in dictionary) {
        if (i == index)
            return item
        ++i
    }
}