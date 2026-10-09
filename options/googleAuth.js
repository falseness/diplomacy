// Google Identity Services ID-token sign-in (server/docs/auth-lobby-protocol.md 2.1).
// Loaded only by the online sign-in screen; hot seat and load game never call it.
const GOOGLE_CLIENT_ID = '341328716448-f4tjgphrm06b0tdme5r0rqqjhuds5smt.apps.googleusercontent.com'

let googleIdentityLoading = null

// Injects the GIS script once; resolves with google.accounts.id when it exists.
function googleIdentityAPI() {
    const id = window.google?.accounts?.id
    return typeof id?.initialize === 'function' && typeof id?.renderButton === 'function' ? id : null
}

function loadGoogleIdentity() {
    if (!googleIdentityLoading) googleIdentityLoading = new Promise((resolve, reject) => {
        if (googleIdentityAPI()) return resolve(googleIdentityAPI())
        const script = document.createElement('script')
        script.src = 'https://accounts.google.com/gsi/client'
        script.async = true
        script.onload = () => googleIdentityAPI() ? resolve(googleIdentityAPI())
            : reject(new Error('GOOGLE_SCRIPT_LOAD_FAILED'))
        script.onerror = () => reject(new Error('GOOGLE_SCRIPT_LOAD_FAILED'))
        document.head.appendChild(script)
    }).catch(error => {
        // A failed load may be retried by opening the sign-in screen again.
        googleIdentityLoading = null
        throw error
    })
    return googleIdentityLoading
}

// Renders the standard 'Sign in with Google' button; onCredential receives the ID token.
function renderGoogleButton(container, onCredential) {
    const id = window.google.accounts.id
    id.initialize({client_id: GOOGLE_CLIENT_ID, callback: response => onCredential(response?.credential)})
    id.renderButton(container, {type: 'standard', theme: 'outline', size: 'large', text: 'signin_with'})
}
