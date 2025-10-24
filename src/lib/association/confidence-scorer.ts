/**
 * Confidence scoring algorithm for IMU-FIT file associations
 */

import { AssociationOverlap, AssociationConfig, AssociationValidationResult } from './types'

export class ConfidenceScorer {
  /**
   * Calculate confidence score for an association
   */
  static calculateConfidence(
    overlap: AssociationOverlap,
    config: AssociationConfig
  ): number {
    // Validate inputs
    const validation = this.validateAssociation(overlap, config)
    if (!validation.valid) {
      return 0.0
    }
    
    // Calculate component scores
    const coverageScore = this.calculateCoverageScore(overlap)
    const durationScore = this.calculateDurationScore(overlap)
    const balanceScore = this.calculateBalanceScore(overlap)
    
    // Weighted combination
    const confidence = (
      coverageScore * 0.6 +  // 60% weight on coverage
      durationScore * 0.2 +  // 20% weight on duration
      balanceScore * 0.2     // 20% weight on balance
    )
    
    return Math.min(Math.max(confidence, 0.0), 1.0) // Clamp to [0, 1]
  }
  
  /**
   * Calculate coverage score based on average overlap coverage
   */
  private static calculateCoverageScore(overlap: AssociationOverlap): number {
    const avgCoverage = (overlap.imuCoverage + overlap.fitCoverage) / 2
    
    // Coverage scoring curve:
    // 0-50%: Linear from 0 to 0.5
    // 50-80%: Linear from 0.5 to 0.8
    // 80-100%: Linear from 0.8 to 1.0
    if (avgCoverage <= 0.5) {
      return avgCoverage * 2 // 0 to 0.5
    } else if (avgCoverage <= 0.8) {
      return 0.5 + (avgCoverage - 0.5) * (0.8 - 0.5) / (0.8 - 0.5) // 0.5 to 0.8
    } else {
      return 0.8 + (avgCoverage - 0.8) * (1.0 - 0.8) / (1.0 - 0.8) // 0.8 to 1.0
    }
  }
  
  /**
   * Calculate duration score based on overlap duration
   */
  private static calculateDurationScore(overlap: AssociationOverlap): number {
    // Handle both milliseconds and minutes (for backward compatibility)
    let durationMinutes: number
    if (overlap.duration > 100000) {
      // Assume milliseconds if duration is large
      durationMinutes = overlap.duration / (1000 * 60)
    } else {
      // Assume minutes if duration is small
      durationMinutes = overlap.duration
    }
    
    // Duration scoring:
    // < 2 min: 0.0
    // 2-5 min: 0.0 to 0.3
    // 5-15 min: 0.3 to 0.5
    // 15-60 min: 0.5 to 0.8
    // > 60 min: 0.8 to 1.0
    if (durationMinutes < 2) {
      return 0.0
    } else if (durationMinutes < 5) {
      return (durationMinutes - 2) / 3 * 0.3 // 0 to 0.3
    } else if (durationMinutes < 15) {
      return 0.3 + (durationMinutes - 5) / 10 * 0.2 // 0.3 to 0.5
    } else if (durationMinutes < 60) {
      return 0.5 + (durationMinutes - 15) / 45 * 0.3 // 0.5 to 0.8
    } else {
      return Math.min(0.8 + (durationMinutes - 60) / 60 * 0.2, 1.0) // 0.8 to 1.0
    }
  }
  
  /**
   * Calculate balance score based on coverage balance
   */
  private static calculateBalanceScore(overlap: AssociationOverlap): number {
    const coverageDiff = Math.abs(overlap.imuCoverage - overlap.fitCoverage)
    
    // Balance scoring (more forgiving for partial overlaps):
    // Perfect balance (0% diff): 1.0
    // 25% difference: 0.8
    // 50% difference: 0.6
    // 75% difference: 0.4
    // 100% difference: 0.2 (not 0.0 to avoid complete failure)
    return Math.max(1.0 - (coverageDiff * 0.8), 0.2)
  }
  
  /**
   * Validate association parameters
   */
  static validateAssociation(
    overlap: AssociationOverlap,
    config: AssociationConfig
  ): AssociationValidationResult {
    const errors: string[] = []
    const warnings: string[] = []
    const suggestions: string[] = []
    
    // Check minimum overlap duration
    // Handle both milliseconds and minutes (for backward compatibility)
    let overlapMinutes: number
    if (overlap.duration > 100000) {
      // Assume milliseconds if duration is large
      overlapMinutes = overlap.duration / (1000 * 60)
    } else {
      // Assume minutes if duration is small
      overlapMinutes = overlap.duration
    }
    
    if (overlapMinutes < config.minOverlapMinutes) {
      errors.push(`Overlap duration (${overlapMinutes.toFixed(1)} min) is less than minimum required (${config.minOverlapMinutes} min)`)
    }
    
    // Check coverage thresholds
    if (overlap.imuCoverage < 0.1) {
      warnings.push(`Low IMU coverage: ${(overlap.imuCoverage * 100).toFixed(1)}%`)
      suggestions.push('Consider checking IMU data quality and sampling rate')
    }
    
    if (overlap.fitCoverage < 0.1) {
      warnings.push(`Low FIT coverage: ${(overlap.fitCoverage * 100).toFixed(1)}%`)
      suggestions.push('Consider checking FIT file completeness')
    }
    
    // Check coverage balance
    const coverageDiff = Math.abs(overlap.imuCoverage - overlap.fitCoverage)
    if (coverageDiff > 0.5) {
      warnings.push(`Unbalanced coverage: IMU ${(overlap.imuCoverage * 100).toFixed(1)}% vs FIT ${(overlap.fitCoverage * 100).toFixed(1)}%`)
      suggestions.push('Consider adjusting time ranges or checking data quality')
    }
    
    // Check for very short overlaps
    if (overlapMinutes < 2) {
      warnings.push(`Very short overlap: ${overlapMinutes.toFixed(1)} minutes`)
      suggestions.push('Consider manual verification of association')
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions
    }
  }
  
  /**
   * Get confidence level description
   */
  static getConfidenceLevel(confidence: number): string {
    if (confidence >= 0.9) return 'Excellent'
    if (confidence >= 0.8) return 'Very Good'
    if (confidence >= 0.7) return 'Good'
    if (confidence >= 0.6) return 'Fair'
    if (confidence >= 0.4) return 'Poor'
    return 'Very Poor'
  }
  
  /**
   * Get confidence color for UI
   */
  static getConfidenceColor(confidence: number): string {
    if (confidence >= 0.8) return 'green'
    if (confidence >= 0.6) return 'yellow'
    if (confidence >= 0.4) return 'orange'
    return 'red'
  }
  
  /**
   * Calculate detailed confidence breakdown
   */
  static getConfidenceBreakdown(overlap: AssociationOverlap) {
    const coverageScore = this.calculateCoverageScore(overlap)
    const durationScore = this.calculateDurationScore(overlap)
    const balanceScore = this.calculateBalanceScore(overlap)
    
    return {
      coverage: {
        score: coverageScore,
        weight: 0.6,
        contribution: coverageScore * 0.6,
        description: `Average coverage: ${((overlap.imuCoverage + overlap.fitCoverage) / 2 * 100).toFixed(1)}%`
      },
      duration: {
        score: durationScore,
        weight: 0.2,
        contribution: durationScore * 0.2,
        description: `Overlap duration: ${overlap.duration > 100000 ? (overlap.duration / (1000 * 60)).toFixed(1) : overlap.duration.toFixed(1)} min`
      },
      balance: {
        score: balanceScore,
        weight: 0.2,
        contribution: balanceScore * 0.2,
        description: `Coverage balance: ${(100 - Math.abs(overlap.imuCoverage - overlap.fitCoverage) * 100).toFixed(1)}%`
      },
      total: coverageScore * 0.6 + durationScore * 0.2 + balanceScore * 0.2
    }
  }
}
