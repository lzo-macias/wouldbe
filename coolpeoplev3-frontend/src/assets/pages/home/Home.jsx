import React, { useState } from 'react'
import HomeHeader from '../../component/header/HomeHeader'
import Grid2x from '../../component/grid/Grid2x'
import { DEFAULT_FILTERS } from '../../lib/homeFilters'

// Filter state lives here because BOTH children need it: the header renders the
// control, the grid does the fetching. Lifting it is the only way they can agree
// on what is applied.
function Home() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)

  return (
    <div>
        <HomeHeader filters={filters} onFiltersChange={setFilters} />
        <Grid2x filters={filters} />
    </div>
  )
}

export default Home
