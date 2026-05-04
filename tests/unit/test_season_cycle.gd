extends GutTest

var season: SeasonCycle

func before_each() -> void:
    season = SeasonCycle.new()
    add_child(season)
    season.reset()


func after_each() -> void:
    season.queue_free()


func test_initial_season() -> void:
    assert_eq(season.get_current_season(), SeasonCycle.Season.SPRING)
    assert_eq(season.get_season_round(), 1)
    assert_eq(season.get_total_round(), 0)


func test_advance_round_within_season() -> void:
    # 假设第一个季节长度 >= 1
    season.advance_round()
    assert_eq(season.get_season_round(), 2)
    assert_eq(season.get_total_round(), 1)
    assert_eq(season.get_current_season(), SeasonCycle.Season.SPRING)


func test_advance_round_trigger_season_change() -> void:
    # 强制设置季节长度为1
    season._season_lengths[0] = 1
    season._season_round = 1
    var changed: bool = false
    season.season_changed.connect(func(new, old): changed = true)
    season.advance_round()
    assert_true(changed)
    assert_eq(season.get_current_season(), SeasonCycle.Season.SUMMER)
    assert_eq(season.get_season_round(), 1)
    assert_eq(season.get_total_round(), 1)


func test_advance_multiple_rounds() -> void:
    # 让第一季长度为3
    season._season_lengths[0] = 3
    for i in range(3):
        season.advance_round()
    # 此刻应该在第二季第一回合
    assert_eq(season.get_current_season(), SeasonCycle.Season.SUMMER)
    assert_eq(season.get_season_round(), 1)
    assert_eq(season.get_total_round(), 3)


func test_is_season_end() -> void:
    season._season_lengths[0] = 5
    season._season_round = 5
    assert_true(season.is_season_end())
    season._season_round = 4
    assert_false(season.is_season_end())


func test_game_complete() -> void:
    season._total_round = SeasonCycle.TOTAL_TURNS
    assert_true(season.is_game_complete())
    season._total_round = 59
    assert_false(season.is_game_complete())


func test_season_names() -> void:
    assert_eq(season.get_season_name(SeasonCycle.Season.SPRING), "spring")
    assert_eq(season.get_season_name(SeasonCycle.Season.SUMMER), "summer")
    assert_eq(season.get_season_name(SeasonCycle.Season.AUTUMN), "autumn")
    assert_eq(season.get_season_name(SeasonCycle.Season.WINTER), "winter")


func test_season_lengths_sum_to_total() -> void:
    var sum: int = 0
    for length in season._season_lengths:
        sum += length
    assert_eq(sum, SeasonCycle.TOTAL_TURNS)
