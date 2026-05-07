import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import ConfidencePill from './ConfidencePill'
import ConfidenceBar from './ConfidenceBar'
import {
  formatDelta,
  getConfidenceDelta,
  isHighDisagreement,
  normalizeAiConfidence,
  normalizeMachineConfidence
} from '../../utils/confidence'

const MACHINE_TOOLTIP = 'Based on indicators, volume, trend filters'
const AI_TOOLTIP = 'Based on AI review of full signal context'

const ConfidenceComparison = ({ machineConfidenceRaw, aiConfidenceRaw, expanded = false }) => {
  const machine = normalizeMachineConfidence(machineConfidenceRaw)
  const aiValue = normalizeAiConfidence(aiConfidenceRaw)
  const aiMissing = aiValue == null
  const delta = getConfidenceDelta(aiValue, machine.value)
  const disagreement = isHighDisagreement(delta)

  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: '14px',
        border: '1px solid #2a3a55',
        background: expanded
          ? 'linear-gradient(180deg, #101c31 0%, #0f182a 100%)'
          : 'linear-gradient(180deg, #111f34 0%, #0f1a2d 100%)'
      }}
    >
      <CardContent sx={{ p: expanded ? 2 : 1.5, '&:last-child': { pb: expanded ? 2 : 1.5 } }}>
        <div className="flex flex-wrap items-center gap-2">
          <ConfidencePill
            label="Rule Engine Confidence"
            value={machine.value}
            missing={machine.missing}
            subtleWarning={machine.missing}
            tooltip={MACHINE_TOOLTIP}
          />
          <ConfidencePill
            label="AI Probability Confidence"
            value={aiValue ?? 0}
            missing={aiMissing}
            tooltip={AI_TOOLTIP}
          />
          <Tooltip title="AI confidence minus machine confidence" arrow>
            <Chip
              size="small"
              label={`Delta ${formatDelta(delta)}`}
              sx={{
                color: '#eaf2ff',
                backgroundColor: '#20314d',
                border: '1px solid #355074',
                '& .MuiChip-label': { fontWeight: 700 }
              }}
            />
          </Tooltip>
          {disagreement && (
            <Chip
              size="small"
              label="High disagreement"
              sx={{
                color: '#ffd56a',
                backgroundColor: '#3a2d10',
                border: '1px solid #6b551f',
                '& .MuiChip-label': { fontWeight: 700 }
              }}
            />
          )}
        </div>

        <div className={`mt-3 grid grid-cols-1 ${expanded ? 'md:grid-cols-2' : ''} gap-3`}>
          <ConfidenceBar
            label="Rule Engine Confidence"
            value={machine.value}
            missing={machine.missing}
            subtleWarning={machine.missing}
            tooltip={MACHINE_TOOLTIP}
            compact={!expanded}
          />
          <ConfidenceBar
            label="AI Probability Confidence"
            value={aiValue ?? 0}
            missing={aiMissing}
            tooltip={AI_TOOLTIP}
            compact={!expanded}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export default ConfidenceComparison
