import { fireEvent, render, screen } from '@testing-library/react-native';

import { PhotoGridField } from '../PhotoGridField';

jest.mock('../../services/photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  persistGardenPhotos: jest.fn(),
}));
jest.mock('../../services/photo-capture.service', () => ({ capturePhoto: jest.fn() }));
jest.mock('../../services/expo-photo-capture.adapter', () => ({
  expoImagePickerPhotoCaptureAdapter: {},
}));

describe('PhotoGridField', () => {
  it('枚数を「n / 上限」で出す', () => {
    render(<PhotoGridField value={['/a.jpg', '/b.jpg']} onChange={jest.fn()} />);
    expect(screen.getByText('2 / 6')).toBeTruthy();
  });

  it('0 枚でも撮影とギャラリーを押せる', () => {
    render(<PhotoGridField value={[]} onChange={jest.fn()} />);

    expect(screen.getByLabelText('写真を撮影')).toBeTruthy();
    expect(screen.getByLabelText('ギャラリーから選ぶ')).toBeTruthy();
  });

  it('上限に達すると撮影・ギャラリーを無効にする', () => {
    render(<PhotoGridField value={['/1', '/2', '/3', '/4', '/5', '/6']} onChange={jest.fn()} />);

    expect(screen.getByLabelText('写真を撮影').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText('ギャラリーから選ぶ').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('×で該当の 1 枚だけ外す', () => {
    const onChange = jest.fn();
    render(<PhotoGridField value={['/a.jpg', '/b.jpg', '/c.jpg']} onChange={onChange} />);

    fireEvent.press(screen.getByLabelText('2枚目の写真を外す'));

    expect(onChange).toHaveBeenCalledWith(['/a.jpg', '/c.jpg']);
  });

  it('同じ URI が並んでも別々に外せる（key の衝突を防いでいる）', () => {
    const onChange = jest.fn();
    render(<PhotoGridField value={['/same.jpg', '/same.jpg']} onChange={onChange} />);

    fireEvent.press(screen.getByLabelText('1枚目の写真を外す'));

    expect(onChange).toHaveBeenCalledWith(['/same.jpg']);
  });

  it('max を明示できる', () => {
    render(<PhotoGridField value={[]} onChange={jest.fn()} max={3} />);
    expect(screen.getByText('0 / 3')).toBeTruthy();
  });
});
