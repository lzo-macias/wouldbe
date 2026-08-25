import React, {useState, useEffect} from 'react'
import "./Header.css"
import { useNavigate } from "react-router-dom"
import api from "../../lib/api"
import { clearAuth } from "../../lib/authStorage"


function Header() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate()

  useEffect(() => {
    async function checkAuth() {
      // Nothing to check if we have no credentials at all.
      if (!localStorage.getItem('token') && !localStorage.getItem('refreshToken')) {
        setLoading(false);
        return;
      }
      try {
        // The api instance attaches the token and refreshes-on-401 for us.
        const { data } = await api.get('/api/auth/me');
        setUser(data);
      } catch (err) {
        clearAuth();
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
    checkAuth()
  }, []);

  async function traveltoLogin(){
    navigate('/login')
  }

  async function traveltoSignup(){
    navigate('/signup')
  }

  return (
    <div className='WouldBeHeader'>
      <div className='LogoandSearch'>
          <div className='WouldbeLogo'>
            <img 
              src="/logos/WouldBeLogo.svg" 
              alt=""
              className=''
            />
        </div>
        <div className='SearchContainer'>
            <img 
                src="/homepagegraphics/Search.svg" 
                alt="Search" 
                className='SearchIcon'
              />
              <p>Search for different campaigns and debate </p>   
        </div>
      </div>

      {!loading && (
        user ? (
          <div className='signout'>
            <button
              onClick={() => { clearAuth(); setUser(null); }}>
              signout
            </button>
          </div>
        ): (
          <div className='actionbtns'>
            <button onClick={traveltoSignup}>signup</button>
            <button onClick={traveltoLogin} className='login'>login</button>
          </div>
        )
      )}
    </div>
  )
}

export default Header