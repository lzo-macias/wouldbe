import React from 'react'
import HomeHeader from '../../component/header/HomeHeader'
import Grid from '../../component/grid/Grid'
import Grid2x from '../../component/grid/Grid2x'

function Home() {
  return (
    <div>
        <HomeHeader></HomeHeader>
        {/* <Grid></Grid> */}
        <Grid2x></Grid2x>
    </div>
  )
}

export default Home