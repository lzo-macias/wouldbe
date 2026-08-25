import React from 'react'
import "./HowItWorksTimeline.css"

function HowItWorksTimeline() {
  return (
    <div>
        <div className='howitworksmaincontainer'>
            {/* <h2>How it Works</h2> */}
            <div className='miniContainer'>
                <div className='numberandgraphic'>
                    <p className='number'>01</p>
                    <svg
                        className='image'
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M12 2v20" />
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                </div>
                <div>
                    <h3>Set a Pledge Goal</h3>
                    <p>Pledges are promises from wouldbe users that if the campaign reaches a certain amount of dollars in pledges they will donate to the campaign</p>
                </div>
            </div>
            <div className='miniContainer'>
                <div className='numberandgraphic'>
                    <p className='number'>02</p>
                    <svg
                        className='image'
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="m9 11 3 3L22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                </div>
                <div >
                    <h3>Choose Your Issues</h3>
                    <p>You will choose your top issues and declare your plan of action this is what users will use to determine your candidacy</p>
                </div>
            </div>
            <div className='miniContainer'>
                <div className='numberandgraphic'>
                    <p className='number'>03</p>
                    <svg
                        className='image'
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <rect x="2" y="4" width="20" height="16" rx="3" />
                        <path d="m10 8 6 4-6 4V8Z" />
                    </svg>
                </div>
                <div>
                    <h3>Set Interactive Posts</h3>
                    <p>Posts videos for your users to better understand your stance easy to share on    social. Join debates to interact with your followers and gain popularity</p>
                </div>
            </div>
            <div className='miniContainer'>
                <div className='numberandgraphic'>
                    <p className='number'>04</p>
                    <svg
                        className='image'
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M6 9V2h12v7a6 6 0 0 1-12 0Z" />
                        <path d="M6 5H4a2 2 0 0 0 0 4h2" />
                        <path d="M18 5h2a2 2 0 0 1 0 4h-2" />
                        <path d="M8 21h8" />
                        <path d="M12 15v6" />
                    </svg>
                </div>
                <div>
                    <h3>Profit</h3>
                    <p className='description'>Succefully met pledge goals get funded. Dont settle for what could be!</p>
                </div>
            </div>
        </div>
        <div className='rowWithDots'></div>
    </div>
  )
}

export default HowItWorksTimeline