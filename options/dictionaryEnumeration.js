function join(dictionary, sepKeyAndValue, sepPairs)
{
    let str = ''
    for (i in dictionary)
    {
        str += i + sepKeyAndValue + dictionary[i] + sepPairs
    }
    return str
}