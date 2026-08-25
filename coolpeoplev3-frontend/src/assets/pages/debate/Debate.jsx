import React, {useState} from 'react'
import Header from '../../component/header/Header'
import "./DebateGradient.css"
import "./Debate.css"

function Debate() {
  const [activeTab, setActiveTab] = useState('ranking');


  return (

    <div className='debategradient'>
        <Header/>

        <div className='maincontainer'>
            <div className='masonryOrStreamOrPostsOrGrid'>
              <img 
                src="/StockImages/Debate.png" 
                alt="" 
                className=''
                />
            </div>
            <div className='debateActionCard'>
              <div>
                <p>follow</p>
              </div>
              <div className='debatecard'>
                <div className='twoDebateTitle'>
                  <h3>Who Would Be The Best President?</h3>
                </div>
                <div className='DebateRibbon'>Debate</div>
                <div className='twocontaintotalcashprizecontainer'>
                  <div className='twototalcashprizecontainer'>
                    <div className='totals'>
                      <h3 className='TotalCashPrize'>TOTAL CASH PRIZE</h3>
                      <h3 className='cash'>$300.00</h3>
                    </div>
                    <div className='add'>
                      <img 
                        src="" 
                        alt="" 
                        className=''
                      />
                      <h3>+ Add</h3>
                    </div>
                  </div>
                </div>
                <div className='mycontestantsandtitle'>
                  <div className='mycontestants'>
                    <div className='containercontestantsmartcircles'>
                      <img 
                        src="/StockImages/Candidate.png" 
                        alt="" 
                        className='contestantsmartcircles'
                      />
                    </div>
                    <div className='containercontestantsmartcircles'>
                        <img 
                        src="/StockImages/Candidatetwo.png" 
                        alt="" 
                        className='contestantsmartcircles'
                      />
                    </div>
                    <div className='containercontestantsmartcircles'>
                      <img 
                        src="/StockImages/candidatethree.png" 
                        alt="" 
                        className='contestantsmartcircles'
                      />
                    </div>
                      <div className='containercontestantsmartcircles'>
                        <img 
                          src="/StockImages/candidatefour.png" 
                          alt="" 
                          className='contestantsmartcircles'
                        />
                    </div>
                      <div className='containercontestantsmartcirclestext'>
                        <p className='plusthreeeighttwo'>+382</p>
                      </div>
                    </div>
                    <div className='howmanycontestants'>
                      <p className='threeeightysix'>386</p>
                      <p className='contestants'>contestants</p>
                    </div>
                </div>
                <div className='twoactionbtns'>
                  <div className='Nominatebutton'>
                    <img 
                      src="/homepagegraphics/NominateStar.svg" 
                      alt="" 
                      className='Star'
                    />
                  <h3>NOMINATE</h3>
                  </div>
                  <div className = "JoinTheDebate">
                    <img 
                      src="/homepagegraphics/Plus.svg" 
                      alt=""
                      className= "plus" 
                    />
                    <h3>Join The Debate</h3>
                  </div>
                </div>
               
                <div>

                </div>
              </div>
            </div>
        </div>
        <div className= {activeTab === 'ranking' ? 'debatesubnavranking' : 'debatesubnavtrending'}>
          <button 
            onClick = {() => setActiveTab("ranking")}
            className= {`tab ${activeTab === 'ranking' ? 'tab-active': 'tab-inactive'}`}
            >
              Ranking
          </button>
          <button 
            onClick = {() => setActiveTab("trending")}
            className= {`tab ${activeTab === 'trending' ? 'tab-active': 'tab-inactive'}`}
            >
              Trending
          </button>
        </div>
        {activeTab === "ranking" && (
            <div>
                TEST
            </div>
        )}
        {activeTab === "trending" && (
            <div>
                TRENDINGTEST
            </div>

        )}
    </div>
  )
}

export default Debate