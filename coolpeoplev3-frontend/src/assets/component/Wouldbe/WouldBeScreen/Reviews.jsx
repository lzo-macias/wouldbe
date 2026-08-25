import React, {useState, useEffect} from 'react'
import api from '../../../lib/api'
import "./Reviews.css"
import "./UserTagsV2.css"

//need be the first to leave a review if live, no reviews, 

function Reviews({user, reviews, Stars}) {
  const [meId, setMeId] = useState(null)
  const [newReviewStars, setNewReviewStars] = useState(0)
  const [newReviewBody, setNewReviewBody] = useState("")
  const [hovered, setHovered] = useState(null)

  useEffect(() => {

    setMeId(localStorage.getItem("userId"))
  }, [])

  const orderedReviews = [...(reviews?.reviews ?? [])].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  )

  if (!user) return null

async function handleSubmit(e) {
  e.DefaultPrevention()
  try{
    const {resData} = api.post(`/api/users/${meId}/reviews`, {
      rating: newReviewStars,
      body: newReviewBody
    })
  }catch(err){
    console.error(err)
  }
}
  return (
    <div className='reviewsbigcontainer'>
        <div className='left'>
                <img 
                    className = "bioprofilephoto"
                    src = {user.profile_photo_url}
                    alt = {`${user.first_name} profile photo`} 
                />
                <div className='starsnameandlinks'>
                    <Stars rating = {reviews.average_rating} />
                    <span>{user.first_name} {user.last_name}</span>
                    <span>{user.link}</span>
                </div>
                {/* userTagsV2, NOT userTags — the .userTags rule in
                    UserOverView.css carries `display: none` to hide the tags on
                    the WouldBe card, and CSS isn't scoped, so it was hiding these
                    too. Own class, own rule, own file.
                    <ul>, not <div>: an <li> outside a list is invalid and picks up
                    unpredictable default styling.
                    Each is guarded — an unguarded {user.college} on someone who
                    hasn't set one renders an EMPTY bordered pill. `age != null`
                    rather than a truthy check so a legitimate 0 isn't dropped. */}
                <ul className='userTagsV2'>
                    {user.age != null && <li>{user.age}</li>}
                    {user.college && <li>{user.college}</li>}
                    {user.state && <li>{user.state}</li>}
                </ul>
          </div>
      <div className='rightReview'>
        <div className='leaveAReview'>
            <h3>Leave A Review</h3>
            <div>
                <div className='starcontainer'>
                  {[1, 2, 3, 4, 5].map((star) => {
                  const active = (star <= newReviewStars || hovered )
                   return (
                      <>
                        <button
                          key = {star}
                          onMouseEnter = {()=>setHovered(star)}
                          onMouseLeave = {()=>setHovered(false)}
                          onClick = {()=>setNewReviewStars(star)}
                          className = {active ? "activeStar" : "notActiveStar"}
                          value = {newReviewStars}
                        >  
                        {/* Separate asset, not a recoloured Star.svg — that file
                            is gold (#D4B84D) and shared by Grid, Grid2x and the
                            Stars component, so editing its fill would turn every
                            star in the app green. An <img> can't be recoloured by
                            CSS either; the fill is baked into the file. */}
                        <img
                          src= {"/homepagegraphics/StarGreen.svg"}
                          alt = "review star icon"
                        />
                        </button>
                      </>
                    )
                  })}
                    {newReviewStars > 0 && (
                            <>
                              <label>Description</label>
                              <textarea
                                value = {newReviewBody}
                                className='newReviewBody'
                                onChange = {(e) => setNewReviewBody(e.target.value)}
                              >
                              </textarea>
                              <button onClick = {handleSubmit}>Submit</button>                     
                            </>
                      )}
                </div>
            </div>
        </div>
        {orderedReviews.map(review => {

          const isMyReview  = review.reviewer_user_id === meId
          const isMyProfile = review.reviewed_user_id === meId

          return (
            <div key={review.id}>
              <div>
                <img
                  src={review.reviewer_photo_url}

                  alt={`${review.reviewer_first_name} ${review.reviewer_last_name} profile photo`}
                />
                <span>{review.reviewer_username}</span>
              </div>
              <div>
                <Stars rating={review.rating} />
                <p>{review.body}</p>

                {isMyReview && <button type='button'>edit</button>}
                {!isMyReview && <button type='button'>report</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Reviews
