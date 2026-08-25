import React, {useState, useRef} from 'react'
import Plans from './Plans'
import Bio from './Bio'
import Reviews from "./Reviews"
import "./PlanReviews.css"

// Green assets, matching the leave-a-review picker. The gold Star.svg stays for
// Grid/Grid2x — recolouring that shared file in place would turn every star in the
// app green, and an <img> can't be recoloured by CSS because the fill is baked in.
const Stars = ({ rating }) => {
  const half = Math.round((Number(rating) || 0) * 2) / 2
  return (
    <span className='reviewStars' aria-hidden = 'true'>
      {[1, 2, 3, 4, 5].map((i) => (
        <img
          key = {i}
          src = {half >= i ? "/homepagegraphics/StarGreen.svg" : half >= i - 0.5 ? "/homepagegraphics/HalfstarGreen.svg" : "/homepagegraphics/StarGreen.svg"}
          className={half >= i - 0.5 ? "reviewStarOn" : "reviewStarOff"}
          alt = ""
        />
      ))}
    </span>
  )
}

function PlanReviews({plans, user, differentOwner, reviews, wouldbe}) {
  const rect = useRef(null)
  const [screen, setScreen] = useState("plan")

  const planReviewsScreen = {
    "plan": (
      <>
      <Plans plans = {plans}/>
      </>
    ),
    "reviews": (
      <>
      <Reviews user = {user} differentOwner = {differentOwner} reviews = {reviews} Stars = {Stars}/>
      </>
    ),
    "bio": (
      <>
      <Bio user = {user} reviews = {reviews} Stars = {Stars}/>
      </>
    )
  }

  return (
    <div>
      <div className = 'planandreviewsbar'>
          <button className = {screen == "bio" ? "active" : "notactive"} onClick={() => setScreen("bio")}>Bio</button>
          <button className = {screen == "plan" ? "active" : "notactive"} onClick={() => setScreen("plan")}>Plan</button>
          {}
          {/* {wouldbe.status == "live" && ( */}
            <button className = {screen == "reviews" ? "active" : "notactive"} onClick={() => setScreen("reviews")}>Reviews</button>
          {/* )} */}
      </div>
      <div>
        {planReviewsScreen[screen]}
      </div>
    </div>
  )
}

export default PlanReviews