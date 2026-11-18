/** City-specific appearance; the seven style ids occupy the existing vertex layout. */
export interface FacadeCity {
  id: string;
  styles: readonly string[];
  /** GLSL constants for floor height, bay width, occupancy and wall colours. */
  parameters: string;
  /** A city may replace the appearance while sharing geometry and baked lighting. */
  fragment?: string;
  trades: readonly string[];
  palette: readonly (readonly [string, string])[];
  font: string;
  signWriting: 'han' | 'latin';
}
