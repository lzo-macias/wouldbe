import React, {useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import api from '../../../lib/api'
import { useNavigate } from 'react-router-dom'
import "./ChooseYourIssues.css"

function ChooseYourIssues({office, jurisdiction, onComplete}) {

const navigate = useNavigate()
const [grayOut, setGrayOut] = useState(true)
const [allInterests, setAllInterests] = useState([])
const [allCategories, setAllCategories] = useState([])
// const [myCategories, setMyCategories] = useState([])
const [myInterest, setMyInterest] = useState([])

//create a new categories useStateVariable
//create a new component which recieves parameter category, renders all interests within that category

const [ageAttestation, setAgeAttestation] = useState(false)
const [eligibleAttestation, setEligibleAttestation] = useState(false)
const [lean, setLean] = useState(undefined)

const [screenv2, setScreenv2] = useState("1")

const [wouldbeDraftId, setWouldBeDraftId] = useState(undefined)
const [planComponents, setPlanComponents] = useState({})

useEffect(() => {
    async function loadData() {
        try{
            const allInterestRes = await api.get("/api/categories")
            setAllInterests(allInterestRes.data ?? []);  
            // unique category_group strings (many leaf categories share a group)
            setAllCategories([...new Set((allInterestRes?.data ?? []).map(c => c.category_group))])

            const userId = localStorage.getItem("userId")
            if (userId){
                const myInterestRes = await api.get(`/api/users/${userId}/interests`)
                setMyInterest(myInterestRes.data ?? [])

                const user = await api.get(`/api/users/${userId}`)
                setLean(user.data.political_lean)
            }

        }catch(err){
            console.error(err)
        }
    }
    loadData()
}, [])

const toggle = (key) => {
    setMyInterest(prev =>
        prev.some(i => i.category_key === key)
            ? prev.filter(i => i.category_key !== key)          // already selected → remove
            : [...prev, allInterests.find(i => i.category_key === key)]  // add the whole object
    )
}

const toggleV2 = (key) => {
    setAgeAttestation(!ageAttestation)
}

const toggleV3 = (key) => {
    setEligibleAttestation(!eligibleAttestation)
}

const isGray = ageAttestation && eligibleAttestation

const isMyCategory = (category_group) =>
    myInterest.some(i => i.category_group === category_group)

//build this slider in practice
// t = 0 at the conservative (dark) end, 1 at the progressive (gold) end
const leanT = Math.min(1, Math.max(0, (Number(lean) - 1) / 9)) || 0;
const bubbleLeft = `${leanT * 100}%`;

// blend the thumb ring between the track's two endpoint colors so it always
// matches the gradient underneath it: #111114 (dark) -> #c9a437 (gold)
const lerpHex = (a, b, t) => {
    const pa = [a.slice(0,2), a.slice(2,4), a.slice(4,6)].map(h => parseInt(h, 16));
    const pb = [b.slice(0,2), b.slice(2,4), b.slice(4,6)].map(h => parseInt(h, 16));
    const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};
const thumbColor = lean == null ? 'var(--gold)' : lerpHex('111114', 'c9a437', leanT);

const onSubmit = async () => {
    try {
        const userId = localStorage.getItem("userId")

        // 1. Attestations MUST be recorded first — /api/wouldbes is gated on
        //    requireAttestation("age_18") + ("us_citizen"), so it has to run
        //    after these commit, not in the same batch (race → 403).
        //    attestation_version is required (NOT NULL); stamp the version of
        //    the attestation text the user agreed to.
        await Promise.all([
            api.post(`/api/attestations`, {
                attestation_type: "age_18",
                attested_value: ageAttestation,
                attestation_version: "1.0",
                context: "candidate_onboarding",
            }),
            api.post(`/api/attestations`, {
                attestation_type: "us_citizen",
                attested_value: eligibleAttestation,
                attestation_version: "1.0",
                context: "candidate_onboarding",
            }),
        ])

        // 2. Save profile bits. NOTE: these routes are PUT, not POST — the
        //    server defines PUT /update/:userId and PUT /users/:userId/interests,
        //    so a POST never matches. Both are owner-only, so userId must be the
        //    logged-in user's id.
        await Promise.all([
            api.put(`/api/users/update/${userId}`, {
                political_lean: Math.round(Number(lean))
            }),
            api.put(`/api/users/${userId}/interests`, {
                // myInterest holds full category objects; the API wants just the keys
                category_keys: myInterest.map(i => i.category_key)
            }),
        ])

        // 3. Campaign (wouldbe) creation is intentionally NOT here. createWouldbeV2
        //    requires title, description, goal_cents, deadline AND race_id — none
        //    of which exist at this screen. The draft must be created in the step
        //    that collects those (StartAWouldBe), then its id passed in as a prop.
        setScreenv2("2")

    }catch(err) {
        console.log(err)
    }
}

const upDateComponent = (key, field, value) => {
    setPlanComponents(prev => ({
        ...prev,
        [key]: {...prev[key], [field]: value}
    }))
}

const onSubmitV2 = async () => {
    const component = object.Entries(planComponents)
        .map(([category_key, v]) => ({category_key, title: v.title, description: v.description}))

    const savingplancomponentsdraft = await api.put(`/api/plans/:${wouldBeDraftId}/components`)
}

function titleCase(str) {
    return str
        .replaceAll("_", " ")
        .replace(/\b\w/g, (char) => char.toUpperCase())
}

// MyInterestsDropDown is defined at MODULE SCOPE (below, after ChooseYourIssues)
// — NOT inside this component. Defining it inline would make it a new function on
// every ChooseYourIssues render, so React would remount it (wiping its hover
// state) every time an interest toggles.

  return  screenv2 == "1" ? ( 
    <div className='MAINCONTINER'>
    <div className='firstScreenBigContainer'>
        <h2></h2>
        <div>
            <div className='bigAttestationContainer'>
                <div className='attestationContainer'>
                    <label>Attest you are {office.regulations.min_age} of age or older</label>
                    <input 
                        className = "ageAttestationInput" 
                        id = "ageAttestation" 
                        value = {ageAttestation} 
                        type="checkbox" 
                        onClick={toggleV2}
                        placeholder=''
                    />
                </div>
                <div className='attestationContainer'> 
                    <label>Attest you are US citizen and eligible for office</label>
                    <input 
                        className = "eligibleAttestationInput" 
                        id = "eligibleAttestation" 
                        value = {eligibleAttestation} 
                        type="checkbox" 
                        onClick={toggleV3}
                        placeholder=''
                    />
                </div>
            </div>
        </div>
        <div className={isGray ? "visilble" : 'grayedOut'}>
            <div className="su-slider-block">
                <div className="su-slider-title">Rate Your Politics</div>
                <div className="su-slider-row">
                    <div className="su-bubble" style={{ left: bubbleLeft }}>{Math.round(Number(lean)) || ''}</div>
                    <input
                        className="su-range"
                        type="range" min="1" max="10" step="any"
                        value={lean ?? 5}
                        onChange={(e) => setLean(e.target.value)}
                        style={{ '--fill': bubbleLeft, '--thumb': thumbColor }}
                    />
                    <div className="su-ends"><span>conservative</span><span>progressive</span></div>
                </div>
            </div>
            <ul className='interestsContainer'>
                {allInterests.map((topic) => {
                    const isSelected = myInterest.some(i => i.category_key === topic.category_key)
                    return (
                        <li
                            key = {topic.category_key}
                            className={isSelected ? "selectedInterest" : "Interest"}
                            onClick={() => toggle(topic.category_key)}
                        >
                            {titleCase(topic.category_key)}
                        </li>
                    )
                })}
            </ul>
        </div>
    </div>
        <footer className='foot'>
            <button className={isGray ? "visilble" : 'grayedOutSkip'} onClick={onSubmit}>Skip</button>
        </footer>
    </div>

  ) : (
    <>
        <div className = "planOfActionContainer">
            <h2 className='planofaction'>plan of action</h2>
            <p className='planofactiondecriptor'>You can decide to do this later, this and the videos you post are what users will use to asses your candidacy</p>
            <div>
                <ul className='categoryslider'>
                    {allCategories.map((c) => {
                    return (
                        <MyInterestsDropDown 
                            key={c} 
                            category_group = {c}
                            allInterests = {allInterests}  
                            myInterests = {myInterest}
                            toggle ={toggle}
                        >
                            <li
                                className={isMyCategory(c) ? "selectedCategory" : "Category"}
                            >
                                {titleCase(c)}
                            </li>
                        </MyInterestsDropDown>
                        )
                    })}
                </ul>
            </div>
            <div className='topicEntries'>
                {myInterest.map((topic) => {
                    return (
                        <div
                            key = {topic.category_key}
                            className='planDiv'
                        > 
                            <button className = "x" onClick={toggle}>x</button>
                            <div className='displayTopic'>{topic.display_name}</div>
                            <input 
                                placeholder='input your plan here or drag and drop video'
                                type="text" 
                                value = {planComponents[topic.category_key]?.description ?? ""}
                                onChange = {(e) => upDateComponent(topic.category_key, "description", e.target.value)}
                                className='planInput'
                            />
                        </div>
                    )
                })}
            </div>
            <div className='foot'>
                <button onClick={() => onComplete()}>Skip</button>
            </div>
        </div>
    </>
  )
}

export default ChooseYourIssues

// ---------------------------------------------------------------------------
// Module-scope so its identity is STABLE across ChooseYourIssues re-renders.
// (If it were nested inside ChooseYourIssues, every toggle would create a new
// function → React remounts it → its `hovered` state resets → the menu closes
// the instant you click an item. This is the fix for exactly that bug.)
// ---------------------------------------------------------------------------
function MyInterestsDropDown({allInterests, category_group, myInterests, toggle, children}){

    const [hovered, setHovered] = useState(false)
    const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 0 })
    const wrapRef = useRef(null)          // the category chip we anchor to
    const closeTimer = useRef(null)       // small delay so we can move INTO the menu
    const overChip = useRef(false)        // is the pointer over the chip?
    const overMenu = useRef(false)        // is the pointer over the menu?

    const interestInCategory = allInterests.filter((i) => i.category_group === category_group)
    const myInterestInCategory = myInterests.filter((i) => i.category_group === category_group)
    const reordered = interestInCategory

    const openMenu = () => {
        clearTimeout(closeTimer.current)
        const r = wrapRef.current?.getBoundingClientRect()
        // getBoundingClientRect is viewport-relative → pairs with position:fixed
        if (r) setPos({ top: r.bottom, left: r.left, minWidth: r.width })
        setHovered(true)
    }
    // Only really close if the pointer is over NEITHER the chip nor the menu.
    const scheduleClose = () => {
        clearTimeout(closeTimer.current)
        closeTimer.current = setTimeout(() => {
            if (!overChip.current && !overMenu.current) setHovered(false)
        }, 120)
    }

    return (
        <div
            ref={wrapRef}
            className="categoryDropdownWrap"
            onMouseEnter={() => { overChip.current = true; openMenu() }}
            onMouseLeave={() => { overChip.current = false; scheduleClose() }}
        >
            {children}

            {hovered && createPortal(
                <ul
                    className="categoryDropdown"
                    style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}
                    onMouseEnter={() => { overMenu.current = true; clearTimeout(closeTimer.current) }}
                    onMouseLeave={() => { overMenu.current = false; scheduleClose() }}
                >
                {reordered.map((interest) => {
                const isSelectedV2 = myInterestInCategory.some((i) => i.category_key === interest.category_key)
                    return (
                        <li
                            key = {interest.category_key}
                            className={isSelectedV2 ? 'selectedInterest': 'interest'}
                            onClick={() => toggle(interest.category_key)}
                        >{interest.display_name}</li>
                    )
                })}
                </ul>,
                document.body    // render OUTSIDE the scroll container so nothing clips it
            )}
        </div>
    )
}