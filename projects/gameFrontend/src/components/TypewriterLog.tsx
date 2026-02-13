import React from 'react';
import { TypeAnimation } from 'react-type-animation';

interface TypewriterLogProps {
  text: string;
  speed?: 1 | 2 | 3 | 4 | 5 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 99;
}

export const TypewriterLog: React.FC<TypewriterLogProps> = ({ text }) => {
  return (
    <div className="inline-block">
      <TypeAnimation
        sequence={[
          text, 
        ]}
        wrapper="span"
        cursor={true} 
        repeat={0}
        speed={70} 
        style={{ 
            whiteSpace: 'pre-wrap', 
            display: 'inline-block',
            fontFamily: 'monospace' 
        }}
        omitDeletionAnimation={true} 
      />
    </div>
  );
};