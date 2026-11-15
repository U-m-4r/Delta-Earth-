import numpy as np
import pytest

from app.raster_display import PALETTE_ANCHORS, colorize_values, palette_color, palette_legend


def test_all_supported_palettes_colorize_intensity():
    values = np.ma.array([[0.0, 0.5, 1.0]])
    for palette in PALETTE_ANCHORS:
        rgba, low, high = colorize_values(values, palette=palette, minimum=0, maximum=1)
        assert rgba.shape == (1, 3, 4)
        assert rgba[0, 0, 3] == 255 and rgba[0, 2, 3] == 255
        assert low == 0 and high == 1


def test_custom_palette_interpolates_expected_endpoints_and_discrete_bands():
    colors = palette_color(np.array([0.0, .2, .4, .6, .8, 1.0]), "custom")
    assert colors[0].tolist() == [0, 0, 139]
    assert colors[-1].tolist() == [255, 0, 0]
    continuous = palette_color(np.array([.01, .99]), "viridis")
    discrete = palette_color(np.array([.01, .19, .21, .39, .81, .99]), "viridis", bands=5)
    assert not np.array_equal(continuous[0], continuous[1])
    assert np.array_equal(discrete[0], discrete[1])
    assert np.array_equal(discrete[2], discrete[3])
    assert np.array_equal(discrete[4], discrete[5])


def test_nodata_and_nonfinite_values_are_transparent_without_mutating_source():
    source = np.array([[1.0, np.nan, np.inf, -np.inf]], dtype=np.float64)
    before = source.copy()
    rgba, _, _ = colorize_values(source, minimum=0, maximum=1)
    assert rgba[0, 0, 3] == 255
    assert np.all(rgba[0, 1:, 3] == 0)
    assert np.array_equal(source, before, equal_nan=True)


def test_manual_range_clips_values_and_constant_range_is_preserved():
    rgba, low, high = colorize_values(np.array([[-10.0, 0.0, 10.0]]),
        palette="grayscale", minimum=-1, maximum=1)
    assert (low, high) == (-1, 1)
    assert rgba[0, 0, 0] == 0 and rgba[0, 2, 0] == 255
    constant, low, high = colorize_values(np.array([[3.0, 3.0]]), minimum=3, maximum=3)
    assert (low, high) == (3, 3)
    assert np.array_equal(constant[0, 0, :3], palette_color(np.array([.5]), "viridis")[0])


def test_percentile_clipping_and_signed_log_handle_negative_and_zero():
    source = np.array([[-100.0, -2.0, 0.0, 1.0, 2.0, 100.0]])
    rgba, low, high = colorize_values(source, lower_percentile=20, upper_percentile=80)
    assert low < 0 < high
    logged, _, _ = colorize_values(source, stretch="log")
    assert logged.shape == (1, 6, 4)
    assert np.all(logged[..., 3] == 255)


def test_legend_includes_palette_and_display_values():
    legend = palette_legend("viridis", -20, 5)
    assert legend["palette"] == "viridis"
    assert legend["stops"] == list(PALETTE_ANCHORS["viridis"])
    assert legend["ticks"][0] == -20 and legend["ticks"][-1] == 5


@pytest.mark.parametrize("low,high", [(float("nan"), 1), (0, float("inf")), (2, 1)])
def test_invalid_manual_display_ranges_are_rejected(low, high):
    with pytest.raises(ValueError):
        colorize_values(np.array([[0.0, 1.0]]), minimum=low, maximum=high)
