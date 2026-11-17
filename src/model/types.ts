export type ParamId = string;                       // equals the Custom Field id
export interface Parameter { id: ParamId; name: string; levels: string[]; fieldId: string; optionIds: string[] } // levels and optionIds worst → best
export interface List { id: string; name: string }
export interface Label { id: string; name: string; colour: string | null }   // Trello colour name, e.g. 'pink_dark'
export interface Member { id: string; fullName: string; initials: string }
export interface DropdownField { id: string; name: string; options: { id: string; text: string; colour: string }[] }
export interface Card {
  id: string; name: string; idList: string; pos: number;
  labelIds: string[]; memberIds: string[]; hasCover: boolean;
  fieldOptions: Record<string, string>;             // fieldId → selected optionId
}
export interface Placement { positions: Record<ParamId, number> }
export interface BoardSnapshot {
  lists: List[]; cards: Card[]; labels: Label[]; members: Member[];
  dropdownFields: DropdownField[]; parameters: Parameter[];
  placements: Record<string, Placement>;            // by card id; a missing entry means no positions
  canEdit: boolean;
}
export type ColourBy = { kind: 'label' } | { kind: 'list' } | { kind: 'member' } | { kind: 'field'; fieldId: string };
export interface ViewSettings {
  across: ParamId | null; up: ParamId | null; listIds: string[];
  colourBy: ColourBy; showImages: boolean; zoom: number; panX: number; panY: number;
}
export type Zone = 'matrix' | 'leftStrip' | 'bottomStrip' | 'tray';
export interface Located { zone: Zone; x: number | null; y: number | null }  // x on Across, y on Up
