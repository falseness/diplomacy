// Passed tutorials of this browser: localStorage key diplomacyTutorialProgress holds
// {"passed": [ids]}. At sign-in the stored list is united with the account's server list.
const TUTORIAL_PROGRESS_KEY = 'diplomacyTutorialProgress'
const TUTORIAL_ID_PATTERN = /^tutorial-\d{1,3}$/

function isTutorialId(id) {
    return typeof id === 'string' && TUTORIAL_ID_PATTERN.test(id)
}
const tutorialNumber = id => Number(id.slice('tutorial-'.length))
// De-duplicated valid ids sorted by tutorial number; anything else in the list is dropped.
function normalizeTutorialIds(list) {
    if (!Array.isArray(list)) return []
    return [...new Set(list.filter(isTutorialId))].sort((a, b) => tutorialNumber(a) - tutorialNumber(b) || (a < b ? -1 : a > b ? 1 : 0))
}
// Missing key, corrupt JSON, a wrong shape or a throwing localStorage all read as [].
function readTutorialPassed() {
    let text = null
    try { text = localStorage.getItem(TUTORIAL_PROGRESS_KEY) } catch (error) { return [] }
    if (typeof text !== 'string') return []
    let data = null
    try { data = JSON.parse(text) } catch (error) { return [] }
    if (!data || typeof data !== 'object') return []
    return normalizeTutorialIds(data.passed)
}
function storeTutorialPassed(passed) {
    try { localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({passed})) } catch (error) {}
}
function markTutorialPassed(id) {
    return mergeTutorialPassed([id])
}
// Writes the union of the stored and the given valid ids and returns it.
function mergeTutorialPassed(list) {
    const passed = normalizeTutorialIds([...readTutorialPassed(), ...(Array.isArray(list) ? list : [])])
    storeTutorialPassed(passed)
    return passed
}
// TASK-1721: the tutorials whose tip offer was shown in this browser (TutorialTips): localStorage key
// diplomacyTutorialTipSeen holds {"seen": [ids]}, beside the progress key. Missing, corrupt or throwing storage reads [].
const TUTORIAL_TIP_SEEN_KEY = 'diplomacyTutorialTipSeen'
function readTutorialTipSeen() {
    let data = null
    try { data = JSON.parse(localStorage.getItem(TUTORIAL_TIP_SEEN_KEY)) } catch (error) { return [] }
    return data && typeof data === 'object' ? normalizeTutorialIds(data.seen) : []
}
function markTutorialTipSeen(id) {
    const seen = normalizeTutorialIds([...readTutorialTipSeen(), id])
    try { localStorage.setItem(TUTORIAL_TIP_SEEN_KEY, JSON.stringify({seen})) } catch (error) {}
    return seen
}
