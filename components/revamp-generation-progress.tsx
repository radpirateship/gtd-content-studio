'use client'

import React from 'react'
import { Pencil, HelpCircle, Sparkles, Link2, Database, Check, Loader2, AlertCircle } from 'lucide-react'

interface RevampGenerationProgressProps {
  currentStep: 'idle' | 'content' | 'faq' | 'polishing' | 'linking' | 'saving' | 'done' | 'error'
  errorMessage?: string
  failedStep?: 'content' | 'faq' | 'polishing' | 'linking' | 'saving'
}

const STEPS = [
  {
    key: 'content',
    number: 1,
    label: 'Rewriting Article',
    description: 'AI is rewriting the article body with improved structure and SEO...',
    icon: Pencil,
  },
  {
    key: 'faq',
    number: 2,
    label: 'Generating FAQ',
    description: 'Creating 8 targeted FAQ questions from real search queries...',
    icon: HelpCircle,
  },
  {
    key: 'polishing',
    number: 3,
    label: 'Polishing & Assembly',
    description: 'Adding quick answer, product CTA, trust badges, testimonials...',
    icon: Sparkles,
  },
  {
    key: 'linking',
    number: 4,
    label: 'Restoring Internal Links',
    description: 'Re-injecting internal links from the original article into natural placements...',
    icon: Link2,
  },
  {
    key: 'saving',
    number: 5,
    label: 'Saving to Database',
    description: 'Saving your revamped article...',
    icon: Database,
  },
]

export function RevampGenerationProgress({ currentStep, errorMessage, failedStep }: RevampGenerationProgressProps) {
  if (currentStep === 'idle') return null

  const isError = currentStep === 'error'
  const isDone = currentStep === 'done'

  const activeKey = isError ? failedStep : currentStep
  const currentStepIndex = STEPS.findIndex(s => s.key === activeKey)

  return (
    <div className="w-full max-w-md">
      {/* Header */}
      <div className="mb-8">
        {isError ? (
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6" style={{ color: '#C72E2F' }} />
            <div>
              <h2 className="text-[16px] font-semibold" style={{ color: '#C72E2F' }}>
                Generation Error
              </h2>
              {errorMessage && (
                <p className="text-[13px] mt-1" style={{ color: 'var(--text3)' }}>
                  {errorMessage}
                </p>
              )}
            </div>
          </div>
        ) : isDone ? (
          <div className="flex items-center gap-3">
            <div
              className="h-8 w-8 rounded-full flex items-center justify-center"
              style={{ background: 'var(--ppw-accent)' }}
            >
              <Check className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-[16px] font-semibold" style={{ color: 'var(--text1)' }}>
              Article Generated Successfully
            </h2>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ppw-accent)' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: 'var(--text1)' }}>
              Generating Your Article
            </h2>
          </div>
        )}
      </div>

      {/* Steps Container */}
      {!isDone && (
        <div className="space-y-6">
          {STEPS.map((step, index) => {
            const Icon = step.icon
            const isFailedStep = isError && step.key === failedStep
            const isActive = !isError && currentStep === step.key
            const isStepDone = currentStepIndex > index
            const isFuture = currentStepIndex < index

            let circleBackground = isStepDone || isActive ? 'var(--ppw-accent)' : 'var(--surface)'
            let circleColor = isStepDone || isActive ? 'white' : 'var(--text3)'
            let labelColor = isActive ? 'var(--ppw-accent)' : isStepDone ? 'var(--text1)' : 'var(--text3)'
            let descColor = isActive || isStepDone ? 'var(--text2)' : 'var(--text4)'

            if (isFailedStep) {
              circleBackground = '#C72E2F'
              circleColor = 'white'
              labelColor = '#C72E2F'
              descColor = 'var(--text2)'
            }

            return (
              <div key={step.key} className="flex gap-4">
                {/* Step Circle & Line */}
                <div className="flex flex-col items-center">
                  {/* Circle */}
                  <div
                    className="h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background: circleBackground,
                      border: isFuture && !isError ? `2px solid var(--border)` : undefined,
                      color: circleColor,
                    }}
                  >
                    {isFailedStep ? (
                      <AlertCircle className="h-4 w-4" />
                    ) : isStepDone ? (
                      <Check className="h-4 w-4" />
                    ) : isActive ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span className="text-[12px] font-semibold">{step.number}</span>
                    )}
                  </div>

                  {/* Connecting Line (not on last step) */}
                  {index < STEPS.length - 1 && (
                    <div
                      className="w-0.5 my-2 flex-1"
                      style={{
                        height: '28px',
                        background: isStepDone ? 'var(--ppw-accent)' : 'var(--border)',
                      }}
                    />
                  )}
                </div>

                {/* Step Content */}
                <div className="pt-0.5 flex-1">
                  <p
                    className="text-[13px] font-semibold"
                    style={{ color: labelColor }}
                  >
                    {step.label}
                    {isFailedStep && <span className="ml-2 text-[11px] font-normal" style={{ color: '#C72E2F' }}>— failed here</span>}
                  </p>
                  <p
                    className="text-[12px] mt-0.5"
                    style={{ color: descColor }}
                  >
                    {isFailedStep && errorMessage ? errorMessage : step.description}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Error State - Retry Info */}
      {isError && (
        <div
          className="mt-6 p-4 rounded-lg border"
          style={{ background: 'var(--bg)', borderColor: '#fcbaba' }}
        >
          <p className="text-[12px] font-semibold mb-1" style={{ color: '#C72E2F' }}>
            What to try:
          </p>
          <ul className="text-[12px] space-y-1" style={{ color: 'var(--text2)' }}>
            {failedStep === 'content' && (
              <>
                <li>• Check that your keyword and category are set correctly</li>
                <li>• Try a shorter word count target</li>
                <li>• Ensure the original article content was loaded</li>
              </>
            )}
            {failedStep === 'faq' && (
              <>
                <li>• FAQ generation failed — check your API key configuration</li>
                <li>• Try again; this step occasionally times out on long keywords</li>
              </>
            )}
            {failedStep === 'polishing' && (
              <>
                <li>• Final assembly failed — this may be a database or API issue</li>
                <li>• Check server logs for more detail</li>
              </>
            )}
            {failedStep === 'linking' && (
              <>
                <li>• Link re-injection is non-fatal — your article was still saved</li>
                <li>• You can add internal links manually via the Workshop Links module</li>
              </>
            )}
            {failedStep === 'saving' && (
              <>
                <li>• Database save failed — check your connection and try again</li>
                <li>• Check server logs for more detail</li>
              </>
            )}
            {!failedStep && (
              <li>• An unexpected error occurred. Check the browser console and server logs for details.</li>
            )}
          </ul>
        </div>
      )}

      {/* Done State - Success Message */}
      {isDone && (
        <div
          className="mt-6 p-4 rounded-lg border"
          style={{ background: 'var(--bg)', borderColor: 'var(--ppw-accent)' }}
        >
          <p className="text-[12px]" style={{ color: 'var(--text2)' }}>
            Your article has been revamped with improved structure, new content, FAQ section, and schema markup. Ready to publish!
          </p>
        </div>
      )}
    </div>
  )
}
