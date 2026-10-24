import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ColorInput, normalizeHexColor } from './input.js';

describe('colour codes', () => {
  it('reads codes as typed or pasted', () => {
    expect(normalizeHexColor('#1E3A8A')).toBe('#1e3a8a');
    expect(normalizeHexColor(' 1e3a8a ')).toBe('#1e3a8a');
    expect(normalizeHexColor('#abc')).toBe('#aabbcc');
    expect(normalizeHexColor('#12345')).toBeNull();
    expect(normalizeHexColor('blue')).toBeNull();
  });

  it('changes the colour only on a valid code and tidies it on leaving', () => {
    function Probe() {
      const [value, setValue] = useState('#1e3a8a');
      return (
        <>
          <ColorInput label="Brand color" value={value} onChange={setValue} />
          <output>{value}</output>
        </>
      );
    }
    render(<Probe />);
    const code = screen.getByLabelText('Brand color (#rrggbb)');
    fireEvent.change(code, { target: { value: 'ff6' } });
    // Three digits could be the start of a longer code: nothing changes while typing.
    expect(screen.getByRole('status')).toHaveTextContent('#1e3a8a');
    fireEvent.change(code, { target: { value: 'ff66' } });
    expect(code).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(code, { target: { value: 'FF6600' } });
    expect(screen.getByRole('status')).toHaveTextContent('#ff6600');
    expect(code).toHaveValue('#ff6600');
    expect(screen.getByLabelText('Brand color')).toHaveValue('#ff6600');
    fireEvent.change(code, { target: { value: '#0f0' } });
    fireEvent.blur(code);
    expect(screen.getByRole('status')).toHaveTextContent('#00ff00');
    fireEvent.change(code, { target: { value: 'nope' } });
    fireEvent.blur(code);
    // An invalid code is dropped and the colour stays.
    expect(code).toHaveValue('#00ff00');
  });
});
