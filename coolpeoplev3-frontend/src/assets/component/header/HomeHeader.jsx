import React, {useEffect, useState} from 'react'
import api from '../../lib/api'
import "./HomeHeader.css"
import { useNavigate } from 'react-router-dom'
import HomeFilter from './HomeFilter'


function HomeHeader({ filters, onFiltersChange }) {
    const [travelToMyWouldBes, setTravelToMyWouldBes] = useState(false)
    // The signed-in user's own avatar, so the button is a picture of THEM
    // rather than a generic glyph once we know who they are. Read from the
    // same /auth/me the rest of the header already relies on.
    const [me, setMe] = useState(null)

    const navigate = useNavigate()
    const userId = localStorage.getItem('userId')
    const photo = me?.profile_photo_url || null

    // Signed out, this is the sign-in door. Sending somebody to /u/null would
    // render a 404 for a state that is not an error.
    const goToProfile = () => navigate(userId ? `/u/${userId}` : '/login')
    async function travelToWouldbes(travelToMyWouldBes) {
        // e.preventDefault()
        if (travelToMyWouldBes) {navigate('/myWouldBe')}
        else {navigate('/Wouldbe')}
    }

    async function travelToStartADebate() {
        navigate("/startadebate")
    }

    useEffect(() => {
    let cancelled = false
    async function loadData() {
        try{
            const { data } = await api.get("/api/wouldbes/mine")
            if (cancelled) return
            if (data.length > 0) setTravelToMyWouldBes(true)
        }catch(err){
            console.error(err)
            if (!cancelled) setTravelToMyWouldBes(false)
        }
    }
    // Whose face goes on the profile button. Separate from the call above and
    // deliberately silent on failure: a header that logs an error every time a
    // logged-out visitor loads the home page is noise, and the fallback glyph
    // is a perfectly good answer.
    async function loadMe() {
        if (!localStorage.getItem('token')) return
        try {
            const { data } = await api.get('/api/auth/me')
            if (!cancelled) setMe(data)
        } catch {
            if (!cancelled) setMe(null)
        }
    }
    loadData()
    loadMe()
    return () => { cancelled = true}
  }, [])
  return (
    <div className='main_container'>
        <div className= "Logoandsearchbar">
            <div className='HomeBrand'>
                <img 
                src="/logos/WouldBeLogo.svg" 
                alt="WouldBe_By_CoolPeople" 
                className='HomeLogo'
                />
                {/* What this place IS, under the mark that names it. Plain text
                    rather than a pill: it reads as part of the wordmark that
                    way, and a bordered chip under a logo reads as a status
                    badge — a thing that changes — which this does not. */}
                <p className='HomeTagline'>
                    a fundraising platform for candidates under 45 years old
                </p>
            </div>
            
            {/* Bar and filter button share ONE wrapping flex line. The button
                sits to the right of the bar and drops beneath it only when the
                line genuinely runs out of room — wrap decides that by
                measurement, so it happens exactly when the two would otherwise
                crowd the action buttons rather than at a guessed breakpoint. */}
            <div className='HomeSearchRow'>
                <div className='HomeSearchContainer'>
                    <img 
                    src="/homepagegraphics/Search.svg" 
                    alt="Search" 
                    className='SearchIcon'
                    />
                </div>
                {filters && (
                    <HomeFilter value={filters} onChange={onFiltersChange} />
                )}
                {/* THE WAY BACK TO YOURSELF, between the filter and the two
                    action buttons. Icon-only because it is the one control here
                    that needs no explanation — a face is the universal word for
                    "you" — and because the pair beside it is already carrying
                    two labels; a third would make the row read as three equal
                    choices rather than as two actions and a destination.

                    Signed out it goes to /login rather than hiding: a profile
                    button that appears only once you have an account is a
                    feature nobody discovers they were missing. */}
                <button
                    type="button"
                    className="HomeProfileBtn"
                    onClick={goToProfile}
                    aria-label={userId ? 'Your profile' : 'Sign in'}
                    title={userId ? 'Your profile' : 'Sign in'}
                >
                    {photo ? (
                        <img src={photo} alt="" />
                    ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
                             aria-hidden="true">
                            <circle cx="12" cy="8.2" r="3.9" />
                            <path d="M4.6 20a7.4 7.4 0 0114.8 0" />
                        </svg>
                    )}
                </button>
            </div>
            {/* <div>
                <h3 className='login'>Login</h3>
            </div> */}
        </div>

        <div className='HomeHeaderActionButtons'>
            {/* ALSO A REAL BUTTON NOW, for the same reasons its twin below is:
                as an <img> the label was outlined paths that no screen reader,
                no find-in-page and no text zoom could reach, and the shape could
                not respond to a hover, a focus ring or a theme.

                It is the ink half of the pair — same 164x38 box, same 12px
                radius, same italic weight, same specular. Where the Debate
                button reads the brushed gold plate, this one reads a black
                plate built from the same recipe, so the two are one object in
                two finishes rather than two designs that happen to be adjacent. */}
            <button
                type="button"
                className="wb-btn headerActionBtn headerActionBtn--ink"
                onClick={()=> {travelToWouldbes(travelToMyWouldBes)}}
            >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2.4"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                </svg>
                Would Be
            </button>
            {/* A REAL BUTTON, not a picture of one. As an <img> the gold was
                baked into the file: it could not take the plate's hover slide,
                could not inherit a token, and its label was outlined paths that
                no screen reader or find-in-page could reach. Same 164x38 and the
                same 12px radius, so the pair with "+ Would Be" is unchanged. */}
            <button
                type="button"
                className="wb-btn wb-btn--primary headerActionBtn"
                onClick={travelToStartADebate}
            >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2.4"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                </svg>
                Debate
            </button>
        </div>
    </div>

  )
}

export default HomeHeader