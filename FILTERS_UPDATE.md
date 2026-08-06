# Old Boys Directory Filters Update

## Summary
Added 8 new filter options to the Old Boys directory to match the requirements shown in the Notion screenshot. Five related filters (Current Parent, Current Staff Member, Old Boy, Past Parent, Past Staff Member) are combined into a single "School Relationship" filter where users can select multiple options.

## Filters Added

1. **Class of** - Filter by graduation year/decade with checkboxes
2. **Country** - Already existed as "Location", renamed for clarity
3. **School Relationship** - Multi-select containing:
   - Current Parent
   - Current Staff Member
   - Old Boy
   - Past Parent
   - Past Staff Member
4. **Occupation** - Text-based search for occupations
5. **Province** - Multi-select filter for provinces (derived from SA_CITIES constant)

## Files Modified

### src/components/DirectoryFilters.jsx
- **EMPTY_FILTERS object**: Added 5 new filter fields with appropriate default values
  - `classOf: []`
  - `occupations: []`
  - `provinces: []`
  - `schoolRelationship: []` (combines the 5 relationship types)

- **matches() function**: Updated filter matching logic to handle all new filters
  - Checks boolean fields gracefully (returns false if field is missing/false)
  - Handles occupation matching with comma-separated values
  - Checks province against profile data
  - School relationship checks if any selected relationship type matches the profile

- **DirectoryFilterPanel component**: Added UI sections for each new filter
  - **Class of**: Checkboxes for each decade
  - **Country**: Multi-select autocomplete (renamed from Location)
  - **Occupation**: Text input for searching/adding occupations
  - **School Relationship**: Multi-checkbox filter containing:
    - Current Parent
    - Current Staff Member
    - Old Boy
    - Past Parent
    - Past Staff Member
  - **Province**: Multi-select autocomplete derived from SA_CITIES

### src/styles.css
Added new CSS classes for filter UI:
- `.filter-checkbox-list` - Flex container for checkbox lists
- `.checkbox-label` - Styled label with checkbox, hover states
- `.checkbox-label input[type="checkbox"]` - Checkbox styling with orange accent

## Implementation Notes

1. **Database fields**: The boolean profile fields (is_current_parent, is_current_staff, is_old_boy, is_past_parent, is_past_staff) don't exist yet in the database. The filtering logic gracefully handles missing fields by treating them as false.

2. **Provinces**: Province filter extracts province values from the existing SA_CITIES constant by parsing the city,province format.

3. **Occupations**: Allows free-text entry of occupation values. The matching is case-insensitive and can match partial occupation names.

4. **Backwards compatibility**: All new filters default to empty/false, so existing filters continue to work unchanged.

## Next Steps (Optional)

To fully support these filters in the database, consider adding migrations to create:
- `is_current_parent boolean default false`
- `is_current_staff boolean default false`
- `is_old_boy boolean default false`
- `is_past_parent boolean default false`
- `is_past_staff boolean default false`

And update the PEOPLE_SELECT query in DirectoryFilters.jsx to include these fields.
