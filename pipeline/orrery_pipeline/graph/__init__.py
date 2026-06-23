"""Edge scoring + propagation. Turns raw assertions (mapped through resolution) into
scored statements, and traces confidence/strength along paths. Two numbers per edge,
never conflated: confidence (is it real?) and strength (how meaningful, if real?)."""
