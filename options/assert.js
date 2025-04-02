

function assert(condition, text = "") {
    if (condition) {
        return
    }
    console.assert(condition, text)
    throw new Error(text || "Assertion failed");
}