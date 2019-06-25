function getLength(dictionary) {
    let count = 0
    for (i in dictionary) {
        count++
    }
    return count
}

function join(dictionary, sepKeyAndValue, sepPairs) {
    let str = ''
    let count = getLength(dictionary)

    let index = 0
    for (i in dictionary) {
        str += i + sepKeyAndValue + dictionary[i]

        if (++index < count)
            str += sepPairs
    }
    return str
}