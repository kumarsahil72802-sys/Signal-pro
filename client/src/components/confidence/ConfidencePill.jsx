import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import { getConfidenceBand } from '../../utils/confidence'

const missingSx = {
  color: '#9bb0d3',
  backgroundColor: '#18253a',
  border: '1px solid #30435f',
  '& .MuiChip-label': { fontWeight: 600 }
}

const warningSx = {
  color: '#ffd56a',
  backgroundColor: '#3a2d10',
  border: '1px solid #6b551f',
  '& .MuiChip-label': { fontWeight: 600 }
}

const buildBandSx = (band) => ({
  color: '#ffffff',
  backgroundColor: band.muiColor,
  border: '1px solid rgba(255,255,255,0.22)',
  '& .MuiChip-label': { fontWeight: 700 }
})

const ConfidencePill = ({
  label,
  value,
  missing = false,
  tooltip,
  subtleWarning = false,
  size = 'small'
}) => {
  const band = getConfidenceBand(value ?? 0)
  const scoreText = missing ? 'N/A' : `${value}%`
  const chipLabel = `${label}: ${scoreText}`
  const sx = missing ? (subtleWarning ? warningSx : missingSx) : buildBandSx(band)

  return (
    <Tooltip title={tooltip} arrow placement="top">
      <Chip
        label={chipLabel}
        size={size}
        sx={sx}
      />
    </Tooltip>
  )
}

export default ConfidencePill
