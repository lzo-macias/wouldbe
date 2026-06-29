import React from 'react'
import "../styling/HomeGrid.css"

function Grid() {
  return (
    <div>
        <div className='gridcontainer1'>
            <div className='biggridcomponent'>
                <div className='imagecontainer'>
                    <img 
                        src="/StockImages/Candidate.png" 
                        alt="" 
                        className='biggridcomponentcandidateimage'
                    />
                    <div className='campaign-ribbon'>Campaign</div>
                </div>
                <div className='lowersection'>
                    <div className='profilepicandtitlebig'>
                    <img 
                        src="/StockImages/Candidate.png" 
                        alt="" 
                        className='profilepicbig'
                        />
                    <h3 className='bigtitle'>
                        Lorem ipsum dolor sit amet consectetur adipisicing elit. 
                    </h3>
                    </div>
                     <div className='statpreviews'>
                        <div className='review'>
                        <div className='stars'>
                             <img 
                                src="/homepagegraphics/Star.svg" 
                                alt="" 
                            />
                             <img 
                                src="/homepagegraphics/Star.svg" 
                                alt="" 
                            />
                             <img 
                                src="/homepagegraphics/Star.svg" 
                                alt="" 
                            />
                             <img 
                                src="/homepagegraphics/Halfstar.svg" 
                                alt="" 
                            />
                        </div>
                    <p>363 reviews</p>
                    </div>
                    <div className='timeline'>
                        <img 
                            src="/homepagegraphics/Clock.svg" 
                            alt=""
                            className='clock'
                            // style={{ width: '20px', height: '20px', borderRadius: 0 }}
                        />
                        <p>19 days</p>
                    </div>
                    <div className='percentageofgoal'>
                        <h3>73%</h3>
                        <p>of goal</p>
                    </div>
                    </div>
                </div>
               
            </div>
            <div className='overarchingdebatecomponent'>
            <div className='smallgridcomponentDebate'>
                <h3 className='DebateTitle'>Who Would Be The Best President</h3>
            </div>
            <div className='DebateLowerLevel'>
                    <div className='money'>
                        <img 
                            src="/homepagegraphics/Money.svg" 
                            alt=""
                            className='moneyimg'
                        />
                        <p>$300.00</p>
                    </div>
                    <div className='team'>
                        <img 
                            src="/homepagegraphics/Team.svg" 
                            alt=""
                            className='teamimg'
                        />
                        <p>289 competitors</p>
                    </div>
                    <div className='debatetimeline'>
                        <img 
                            src="/homepagegraphics/Clock.svg" 
                            alt=""
                            className='debatetimelineimg'
                        />
                        <p>19 days</p>
                    </div>
                </div>
            </div>
            <div className='smallgridcomponent'>
                <div className='smallimagecontainer'> 
                    <img 
                        src="/StockImages/Candidatetwo.png" 
                        alt=""
                        className='smallimageimage'
                    />
                    <div className='smallimagebanner'>Campaign</div>
                </div>

                <div className='smallgridcomponentTitleandProfile'>
                         <img 
                            src="/StockImages/Candidatetwo.png" 
                            alt="" 
                            className='smallgridcomponentProfilePic'
                        />
                    <h3>Lorem ipsum dolor sit amet consectetur adipisicing elit</h3>
                </div>
                <div className='smallgirdcomponentstats'>
                    <div className='smallreview'>
                        <div className = 'smallstars'>
                            <img 
                                src="/homepagegraphics/Star.svg" 
                                alt="" 
                                className=''
                                />
                            <img 
                                src="/homepagegraphics/Star.svg" 
                                alt="" 
                                className=''
                                />
                            <img 
                                src="/homepagegraphics/Star.svg" 
                                alt="" 
                                className=''
                                />
                        </div>
                        <p>120 reviews</p>
                    </div>
                    <div className='smalltimelinee'>   
                        <img 
                            src="/homepagegraphics/Clock.svg" 
                            alt="" 
                            className='smallclock'
                        />
                        <p>10 days</p>
                    </div>
                    <div className='smallpercentagetogoal'>
                        <h3>60%</h3>
                        <p>of goal</p>
                    </div>

                </div>
            </div>
            <div className='smallgridcomponent'>
                <div className='smallimagecontainer'>
                <img 
                    src="/StockImages/candidatethree.png" 
                    alt="" 
                    className='smallimageimage'
                />
                <div className='smallimagebanner'>Campaign</div> 
                </div>
                <div className='smallgridcomponentTitleandProfile'>
                    <img 
                        src="/StockImages/candidatethree.png" 
                        alt="" 
                        className='smallgridcomponentProfilePic'
                        />
                    <h3>Lorem ipsum dolor sit amet consectetur adipisicing elit</h3>
                </div>
                <div className='smallgirdcomponentstats'>
                    <div className='smallreview'>
                        <div className = 'smallstars'>
                            <img 
                                src="/homepagegraphics/Star.svg" 
                                alt="" 
                                className=''
                                />
                            <img 
                                src="/homepagegraphics/Star.svg" 
                                alt="" 
                                className=''
                                />
                            <img 
                                src="/homepagegraphics/Star.svg" 
                                alt="" 
                                className=''
                                />
                        </div>
                        <p>120 reviews</p>
                    </div>
                    <div className='smalltimelinee'>   
                        <img 
                            src="/homepagegraphics/Clock.svg" 
                            alt="" 
                            className='smallclock'
                        />
                        <p>10 days</p>
                    </div>
                    <div className='smallpercentagetogoal'>
                        <h3>60%</h3>
                        <p>of goal</p>
                    </div>

                </div>
            </div>
            <div className='smallgridcomponent'>
                 <div className='smallimagecontainer'> 
                    <img 
                        src="/StockImages/candidatefour.png" 
                        alt="" 
                        className='smallimageimage'
                    />
                    <div className='smallimagebanner'>Campaign</div>

                </div>
                <div className='smallgridcomponentTitleandProfile'>
                        <img 
                            src="/StockImages/candidatefour.png" 
                            alt="" 
                            className='smallgridcomponentProfilePic'
                        />
                    <h3>Lorem ipsum dolor sit amet consectetur adipisicing elit</h3>
                </div>
                <div className='smallgirdcomponentstats'>
                    <div className='smallreview'>
                        <div className = 'smallstars'>
                            <img 
                                src="/homepagegraphics/Star.svg" 
                                alt="" 
                                className=''
                                />
                            <img 
                                src="/homepagegraphics/Star.svg" 
                                alt="" 
                                className=''
                                />
                            <img 
                                src="/homepagegraphics/Star.svg" 
                                alt="" 
                                className=''
                                />
                        </div>
                        <p>120 reviews</p>
                    </div>
                    <div className='smalltimelinee'>   
                        <img 
                            src="/homepagegraphics/Clock.svg" 
                            alt="" 
                            className='smallclock'
                        />
                        <p>10 days</p>
                    </div>
                    <div className='smallpercentagetogoal'>
                        <h3>60%</h3>
                        <p>of goal</p>
                    </div>

                </div>
            </div>
        </div>
        <div className='gridcontainer2'>
            <div className='smallgridcomponent'>

            </div>
            <div className='smallgridcomponent'>

            </div>
            <div className='smallgridcomponent'>

            </div>
            <div className='smallgridcomponent'>
            
            </div>
            <div className='smallgridcomponent'>
            
            </div>
            <div className='smallgridcomponent'>

            </div>
            <div className='smallgridcomponent'>

            </div>
            <div className='smallgridcomponent'>

            </div>
            <div className='smallgridcomponent'>
            
            </div>
            <div className='smallgridcomponent'>
            
            </div>
            <div className='smallgridcomponent'>

            </div>
            <div className='smallgridcomponent'>

            </div>
            <div className='smallgridcomponent'>

            </div>
            <div className='smallgridcomponent'>
            
            </div>
            <div className='smallgridcomponent'>
            
            </div>
        </div>
    </div>

  )
}

export default Grid