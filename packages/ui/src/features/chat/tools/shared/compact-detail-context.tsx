import { createContext, useContext } from 'react';
const CompactDetailContext = createContext(false);
export const CompactDetailProvider = CompactDetailContext.Provider;
export const useCompactDetail = () => useContext(CompactDetailContext);
