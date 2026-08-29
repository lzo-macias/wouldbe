import React, {useEffect, useState} from 'react'
import "./Bio.css"
import "./UserTagsV2.css"


// Display form only — the href always uses the stored URL. A profile link reads
// as an identity ("jane.example.com"), and the scheme and trailing slash are
// noise in that context.
const prettyLink = (url) =>
    String(url).replace(/^https?:\/\//i, "").replace(/\/$/, "")

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
                    {/* `reviews?.`, not `reviews.` — this prop is legitimately
                        null on the first render (AnyWouldBe fetches it in a
                        second effect) and stays null if that fetch fails, so an
                        unguarded read is a TypeError that takes the whole tab
                        down. Stars already treats a null rating as 0. */}
                    <Stars rating = {reviews?.average_rating} />
                    <span>{user.first_name} {user.last_name}</span>
                    {/* A real anchor, not the bare <span> this was — the value is
                        a URL and was rendering as dead text nobody could click.
                        Guarded: an unguarded read renders an empty element for
                        the many users with no link, which still takes up space.
                        rel="noopener noreferrer" is required on any target=_blank
                        — without noopener the opened page gets a handle on this
                        one via window.opener and can navigate it away.
                        The href is NOT re-validated here: normalizeLink in
                        DB/platform/users.js already constrains it to http/https
                        on the write path, and re-deriving that per reader is how
                        the two rules drift apart. */}
                    {user.link && (
                        <a
                            className='biolink'
                            href={user.link}
                            target='_blank'
                            rel='noopener noreferrer'
                        >
                            {prettyLink(user.link)}
                        </a>
                    )}
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