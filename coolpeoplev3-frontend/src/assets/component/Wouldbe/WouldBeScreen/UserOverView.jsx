import {useRef, useState, useEffect} from 'react'
import "./UserOverView.css"

// function PlanSwap ({plans}){
//     const [showText, setShowText] = useState(true)
//     const [index, setIndex] = useState(0)
//     const [hovered, setHovered] = useState(false)
//     const timerId = useRef(null)

// useEffect(() => {
//     timerId.current = setTimeout(() => {
//         if (hovered) clearTimeout(timerId.current)
//         toggle()
//     }, 3000)
//     return () => clearTimeout(timerId.current)
// }, [index, showText])


// function toggle() {
//     if (showText == false) setShowText(true)
//     else if (showText == true) setShowText(false)
// }

// function handleEnter(){
//     clearTimeout(timerId.current)
//     setShowText(true)
//     setHovered(true)
// }

// function handleLeave(){
//     setHovered(false)
//     timerId.current = setTimeout(() => {
//         toggle()
//     }, 3000)
//     return () => clearTimeout(timerId.current)
// }
// function changeIndex(index){
//     setIndex(prev => prev + 1 > maxIndex ? 0 : prev + 1 )
// }

// if (!plans?.length) return null //below every hook

// const components = plans.flatMap(p => p.components ?? [])
// const maxIndex = components.length -1;
// const component = components[index]
// if (!component) return null

// return (
//     <>
//                 <div className='componentSwapContainer' key = {component.category_key}
//                     onMouseEnter = {() => handleEnter()}
//                     onMouseLeave = {() => handleLeave()}
//                 >
//                     <div className = 'nextButtonAndTextAndImageContainer'>
//                         <h3 className = 'titleOf'>{component.title}</h3>
//                         {showText ? (
//                             <div className = 'ComponentPlanDescriptorContainer' > 
//                                 <p>{component.description}</p>
//                             </div>
//                             ) : (
//                             <img 
//                                 className = 'Swapperimage'
//                                 src = {component.image_url}
//                                 alt = {`${component.title} image`}
//                             />
//                             )
//                         }
//                         {showText && (<button className = "nextButton" onClick = {() => changeIndex(index)}>{`${">"}`}</button>)}
//                     </div>
//                     <a className = 'seeplans' href={`#${component.category_key}`}>See full campaign plan</a>
//                 </div>
//     </>
// )

// }

// Avatar only. The name line is gone — it sat directly above "Lorenzo for NY
// State Representative District 74", so it said the same thing twice. The avatar
// now pairs with that title instead.
export const ProfileHeader = ({ user }) => {
    if (!user) return null
    return (
        <img
            src={user.profile_photo_url}
            alt={`${user.first_name} ${user.last_name} profile photo`}
            className='userProfilePhoto'
        />
    )
}

// Stars for an average like 3.7 — 3 full, 1 half, 1 empty.
//
// Rounded to the nearest HALF, not floored: 3.9 reading as 3.5 stars understates
// the rating, and floor(3.9) = 3 loses the difference entirely. Math.round(x * 2)/2
// is the standard half-step rounding.
//
// Module scope, so it isn't a new component type on every UserOverView render.
const Stars = ({ rating }) => {
    const half = Math.round((Number(rating) || 0) * 2) / 2
    return (
        <span className='reviewStars' aria-hidden='true'>
            {[1, 2, 3, 4, 5].map((i) => (
                <img
                    key={i}
                    // Halfstar only when this position is exactly the .5 one
                    src={half >= i ? "/homepagegraphics/StarGreen.svg"
                        : half >= i - 0.5 ? "/homepagegraphics/HalfstarGreen.svg"
                        : "/homepagegraphics/StarGreen.svg"}
                    className={half >= i - 0.5 ? "reviewStarOn" : "reviewStarOff"}
                    alt=""
                />
            ))}
        </span>
    )
}

// `user`, not `me` — AnyWouldBe passes user={user}.
// `reviews` is the summary object from GET /api/users/:id/reviews; profileUserId
// is whose profile this is (the WouldBe owner), needed for the review links.

// The Active/Won debate pills that used to sit at the foot of the funding card
// were REMOVED here, not just unmounted: the campaign page's own "Debate record"
// section renders the same debates as full tiles carrying the status, the prize
// and the entrant count. Two lists of the same debates on one screen is one list
// too many, and the pills were the weaker of the two. See PlanReviews for the
// version that survived.

function Images ({components}){
    const [index, setIndex] = useState(0)
    const maxIndex = components.length - 1
    const timerId = useRef(null)

    useEffect(() => {
        if (components.length < 2) return          // nothing to cycle through
        timerId.current = setTimeout(() => {
            // One updater instead of three bugs:
            //  - `index += 1` assigned to a CONST from useState -> TypeError
            //  - `index += 1 > maxIndex` parses as `index += (1 > maxIndex)`,
            //    because > binds tighter than += — it added a boolean
            //  - `setIndex(...prev, prev += 1)` referenced a `prev` that doesn't
            //    exist in that scope, and spread an undefined
            setIndex(prev => (prev + 1 > maxIndex ? 0 : prev + 1))
        }, 3000)
        // Deps were [] so this fired once and stopped. Keyed on index it
        // re-arms each cycle; the cleanup stops a stale timer firing after
        // unmount (and stops two running at once under StrictMode).
        return () => clearTimeout(timerId.current)
    }, [index, maxIndex, components.length])

    // components[index].image_url would throw on an empty list, and on a shrunk
    // one where index is now past the end.
    const component = components[index]
    if (!component) return null

    return (
        <img
            className='Swapperimage'
            src={component.image_url}
            alt={`${component.title} image`}
        />
    )
}

function Titles ({components}) {
    return (
        <div className='planTitles'>
            <h4 className='planTitlesHeading'>Important Issues For Candidate</h4>
            {/* placeholder anchor kept so the heading and list stay one block */}
            {/* <ul>, so the chips are a real list and the count is announced.
                key was missing — React warns and reuses the wrong nodes on reorder */}
            <ul className='planTitlesList'>
                {components.map((component) => (
                    <li className='planTitleChip' key={component.id ?? component.category_key}>
                        {component.title}
                    </li>
                ))}
            </ul>
        </div>
    )
}



function UserOverView({user, plans, reviews}){
    const timerIdV1 = useRef(null)
    const [imageOrTitles, setImageOrTitles] = useState("titles")
    const [hovered, setHovered] = useState(false)
    // `plans` is a SINGLE plan object (or null) — GET /api/wouldbes/:id/plan
    // returns one row. plans.flatMap threw two ways: null.flatMap on the first
    // render, then "flatMap is not a function" once it loaded. The components
    // are one level down.
    const components = plans?.components ?? []

    useEffect(() => {
        if (hovered || imageOrTitles == "images") return
        timerIdV1.current = setTimeout(() => {
            setImageOrTitles(prev => (prev === "titles" ? "images" : "titles"))
        }, 3000)
        return () => clearTimeout(timerIdV1.current)
    }, [imageOrTitles, hovered])


    if (!user) return null

    // null while loading, and average_rating is null when nobody has reviewed —
    // distinct from 0, which would render as a zero-star rating we haven't earned.
    const reviewCount = reviews?.review_count ?? 0
    const hasReviews = reviewCount > 0

  return (
    <div className='bigUserOverview'>
        {/* Avatar + name have MOVED — they're now the header of the pledge column
            (see ProfileHeader, rendered by PledgeCardOverview). The tags stay here
            because they belong with the rest of the profile detail. */}
        <div className='usertagsandheader'>
            <div className='nameAndTags'>
                {/* <ul>, not <div> — these are <li> children, and an <li> outside a
                    list is invalid and gets unpredictable default styling. */}
                {/* Every tag is guarded. An unguarded {user.state} on a user who
                    hasn't set one renders an EMPTY pill — a bordered chip with
                    nothing in it, which reads as a rendering bug rather than an
                    absent field. age is guarded with != null, not a truthy check,
                    because 0 is a legitimate value the loose check would drop. */}
                <ul className='userTags'>
                    {user.state && <li>{user.state}</li>}
                    {user.age != null && <li>{user.age}</li>}
                    {user.college && <li>{user.college}</li>}
                    {user.link && (
                        <li className='userTagLink'>
                            {/* rel="noreferrer noopener" is REQUIRED on a
                                user-supplied target="_blank": without noopener the
                                destination gets a window.opener handle back to this
                                page and can navigate it wherever it likes. */}
                            <a href={user.link} target='_blank' rel='noreferrer noopener'>
                                {user.link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                            </a>
                        </li>
                    )}
                </ul>
            </div>
        </div>
        {/* HIDDEN — review summary and the plan swap card. Commented rather than
            deleted: the data is still fetched and the CSS is still in place, so
            uncommenting either block brings it straight back. */}
        {/*
        {reviews && (
            <div className='reviewSummary'>
                {hasReviews ? (
                    <>
                        <div className='reviewStarsRow'>
                            <Stars rating={reviews.average_rating} />
                            <span className='reviewAverage'>{reviews.average_rating}</span>
                            <span className='reviewCount'>
                                {reviewCount} {reviewCount === 1 ? "review" : "reviews"}
                            </span>
                        </div>
                        <a className='reviewSeeMore' href={`/users/${profileUserId}/reviews`}>see more</a>
                    </>
                ) : (
                    <a className='reviewSeeMore' href={`/users/${profileUserId}/reviews`}>leave a review</a>
                )}
            </div>
        )}
        {components.length > 0 && (
            <div
                className='planSwapCard'
                onMouseEnter = {() => {setHovered(true); setImageOrTitles("titles")}}
                onMouseLeave = {() => setHovered(false)}
            >
                {imageOrTitles == "titles" ? (
                    <Titles components = {components}/>
                ): (
                    <Images components = {components}/>
                )}
            </div>
        )}
        */}

        {/* THE DEBATES ARE NOT HERE ANY MORE. They were a row of pills at the
            foot of the funding card; the page's own "Debate record" section now
            renders the same debates as full tiles, with the status, the prize
            and the count. Two lists of the same thing on one screen is one list
            too many, and the pills were the weaker of the two. DebateSwap and
            DebatePill are kept below — they are what a compact debate list looks
            like if this card ever needs one again. */}
    </div>
  )
}

export default UserOverView