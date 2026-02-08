import React from 'react';
import { TypeAnimation } from 'react-type-animation';

interface TypewriterLogProps {
  text: string;
  speed?: 1 | 2 | 3 | 4 | 5 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 99; // La libreria accetta questi valori (più alto = più lento? No, in questa lib è un indice di velocità, 99 è istantaneo, 50 è medio)
}

export const TypewriterLog: React.FC<TypewriterLogProps> = ({ text }) => {
  return (
    <div className="inline-block">
      <TypeAnimation
        sequence={[
          text, // Scrive il testo
          // Se volessi fare altro dopo potrei aggiungere azioni qui
        ]}
        wrapper="span"
        cursor={true} // Mostra il cursore lampeggiante stile terminale
        repeat={0} // Non ripete
        speed={70} // Velocità di scrittura (più alto = più veloce in questa libreria, o viceversa, controlla doc. Solitamente 50-70 è naturale)
        style={{ 
            whiteSpace: 'pre-wrap', 
            display: 'inline-block',
            fontFamily: 'monospace' // Forza il font mono per realismo
        }}
        omitDeletionAnimation={true} // Non cancella mai, scrive solo
      />
    </div>
  );
};