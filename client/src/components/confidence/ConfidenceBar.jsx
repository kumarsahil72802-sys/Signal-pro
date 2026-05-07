import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import { getConfidenceBand } from '../../utils/confidence'

const ConfidenceBar = ({
  label,
  value,
  missing = false,
  tooltip,
  compact = false,
  subtleWarning = false
}) => {
  const band = getConfidenceBand(value ?? 0)
  const barHeight = compact ? 6 : 9
  const displayValue = missing ? 'N/A' : `${value}%`

  return (
    <div className={`w-full ${compact ? '' : 'space-y-2'}`}>
      <div className="flex items-center justify-between gap-3">
        <Tooltip title={tooltip} arrow placement="top-start">
          <p className={`truncate ${compact ? 'text-[11px]' : 'text-xs'} text-[#8ea2c4]`}>
            {label}
          </p>
        </Tooltip>
        <p className={`shrink-0 font-semibold ${compact ? 'text-[11px]' : 'text-xs'} ${missing && subtleWarning ? 'text-[#ffd56a]' : 'text-[#d8e5f8]'}`}>
          {displayValue}
        </p>
      </div>
      <LinearProgress
        variant="determinate"
        value={missing ? 0 : value}
        sx={{
          height: barHeight,
          borderRadius: 999,
          backgroundColor: missing ? '#1b2a40' : band.trackColor,
          '& .MuiLinearProgress-bar': {
            borderRadius: 999,
            backgroundColor: missing ? '#4b5e7f' : band.muiColor
          }
        }}
      />
    </div>
  )
}

export default ConfidenceBar
