import React, {useEffect, useState} from 'react'
import "./Bio.css"
import "./UserTagsV2.css"


function Bio({user, reviews, Stars}) {

  return (
    <div>
        <div className='bioContainer'>
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
            <div className='right'>
                <p>{user.bio}</p>
            </div>
        </div>
    </div>
  )
}

export default Bio